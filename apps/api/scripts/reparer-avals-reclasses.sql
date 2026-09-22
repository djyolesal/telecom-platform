-- ═══════════════════════════════════════════════════════════════════════════
-- RÉPARATION des avals détachés à tort par le balayage de reclassement.
--
-- Avant le délai de grâce (`oss.delaiReclassementAvalMin`), un aval encore
-- coupé au moment où son amont se rétablissait était promu « racine » et
-- DÉTACHÉ, alors qu'il n'avait qu'un retard de réenregistrement de quelques
-- minutes. Sa coupure porte alors un « [RECLASSÉE] … cause locale à
-- qualifier » qui est faux, et son indisponibilité n'est plus imputée à
-- l'entraînement.
--
-- Version SQL : l'image de production est installée sans outils de
-- développement (npm ci --omit=dev) — ni ts-node, ni le dossier scripts/.
-- psql, lui, est toujours là, dans le conteneur Postgres.
--
--   ESSAI À BLANC (n'écrit rien) :
--     docker exec -i telecom_postgres psql -U <user> -d <base> \
--       -v fenetre=30 -f - < reparer-avals-reclasses.sql
--
--   ÉCRITURE :  ajouter  -v appliquer=1
--
-- Ne répare QUE le cas certain, et se tait sur tout le reste :
--   · l'amont doit être un amont RÉEL du site dans la topologie de
--     transmission — jamais un rapprochement par nom (les homonymes existent) ;
--   · sa clôture doit tomber à la minute inscrite dans la trace ;
--   · l'aval doit s'être rétabli APRÈS son amont et dans la fenêtre donnée ;
--   · un seul amont candidat, sinon la ligne est laissée telle quelle.
--
-- Les horodatages de la base sont en UTC et la trace a été écrite à l'heure de
-- Lomé — le Togo est à UTC+0 toute l'année, la minute se compare directement.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\if :{?fenetre} \else \set fenetre 30 \endif
\if :{?appliquer} \else \set appliquer 0 \endif

BEGIN;

CREATE TEMP TABLE reparation_avals ON COMMIT DROP AS
WITH RECURSIVE amonts AS (
  -- Chaîne de transmission : parent direct, puis parent du parent…
  SELECT s.id AS site_id, s.parent_transmission_id AS amont_id, 1 AS saut
    FROM sites s
   WHERE s.parent_transmission_id IS NOT NULL
  UNION ALL
  SELECT a.site_id, p.parent_transmission_id, a.saut + 1
    FROM amonts a
    JOIN sites p ON p.id = a.amont_id
   WHERE p.parent_transmission_id IS NOT NULL
     AND a.saut < 30            -- garde-fou : référentiel bouclé
),
suspectes AS (
  SELECT c.id, c.site_id, c.date_debut, c.date_fin, c.observations,
         regexp_match(c.observations, 'est rétabli le (\d{2})/(\d{2}) (\d{2}):(\d{2})') AS t
    FROM coupures_reseau c
   WHERE c.origine = 'LOCALE'
     AND c.coupure_origine_id IS NULL
     AND c.observations LIKE '%[RECLASSÉE]%'
),
horodatees AS (
  -- L'année n'est pas dans la trace : celle du début de la coupure, +1 an si
  -- la coupure chevauche le 31 décembre.
  SELECT s.id, s.site_id, s.date_debut, s.date_fin,
         CASE WHEN brut < s.date_debut THEN brut + interval '1 year' ELSE brut END AS minute_amont
    FROM suspectes s,
         LATERAL (SELECT make_timestamp(EXTRACT(YEAR FROM s.date_debut)::int,
                                        s.t[2]::int, s.t[1]::int,
                                        s.t[3]::int, s.t[4]::int, 0) AS brut) b
   WHERE s.t IS NOT NULL
),
candidats AS (
  SELECT h.id AS aval_id, h.site_id AS aval_site, h.date_fin AS aval_fin,
         r.id AS racine_id, r.date_fin AS racine_fin
    FROM horodatees h
    JOIN amonts a ON a.site_id = h.site_id
    JOIN coupures_reseau r
      ON r.site_id = a.amont_id
     AND r.id <> h.id
     AND r.date_fin >= h.minute_amont
     AND r.date_fin <  h.minute_amont + interval '1 minute'
)
SELECT c.aval_id, c.aval_site, c.aval_fin, c.racine_id, c.racine_fin,
       count(*) OVER (PARTITION BY c.aval_id) AS nb_candidats,
       EXTRACT(EPOCH FROM (c.aval_fin - c.racine_fin)) / 60 AS ecart_min
  FROM candidats c;

-- ── Ce qui sera rattaché ────────────────────────────────────────────────────
\echo '── À RATTACHER ────────────────────────────────────────────────────────'
SELECT sa.nom AS aval, sr.nom AS amont,
       round(r.ecart_min) || ' min après l''amont' AS retard,
       to_char(r.racine_fin, 'DD/MM HH24:MI') AS amont_retabli
  FROM reparation_avals r
  JOIN sites sa ON sa.id = r.aval_site
  JOIN coupures_reseau cr ON cr.id = r.racine_id
  JOIN sites sr ON sr.id = cr.site_id
 WHERE r.nb_candidats = 1
   AND r.aval_fin IS NOT NULL
   AND r.ecart_min BETWEEN 0 AND :fenetre
 ORDER BY sa.nom;

-- ── Ce qui est laissé tel quel, et pourquoi ────────────────────────────────
\echo '── LAISSÉ TEL QUEL ────────────────────────────────────────────────────'
SELECT sa.nom AS aval,
       CASE WHEN r.nb_candidats > 1 THEN r.nb_candidats || ' amonts possibles'
            WHEN r.aval_fin IS NULL THEN 'encore coupé'
            WHEN r.ecart_min < 0 THEN 'rétabli AVANT son amont'
            ELSE 'rétabli ' || round(r.ecart_min) || ' min après (hors fenêtre de ' || :fenetre || ' min)'
       END AS motif
  FROM reparation_avals r
  JOIN sites sa ON sa.id = r.aval_site
 WHERE NOT (r.nb_candidats = 1 AND r.aval_fin IS NOT NULL AND r.ecart_min BETWEEN 0 AND :fenetre)
 GROUP BY 1, 2
 ORDER BY 1;

\if :appliquer
UPDATE coupures_reseau c
   SET origine = 'HERITEE',
       coupure_origine_id = r.racine_id,
       -- La trace « [RECLASSÉE] » est retirée : elle affirmait une cause locale
       -- qui n'a jamais existé. Ce qui l'entoure est conservé.
       observations = trim(BOTH E'\n' FROM
         regexp_replace(coalesce(c.observations, ''), E'\n?\\[RECLASSÉE\\][^\n]*', '', 'g'))
         || CASE WHEN trim(BOTH E'\n' FROM regexp_replace(coalesce(c.observations, ''), E'\n?\\[RECLASSÉE\\][^\n]*', '', 'g')) = '' THEN '' ELSE E'\n' END
         || '[CORRIGÉ] Rattaché à l''amont ' || sr.nom || ' : ce site s''est rétabli '
         || round(r.ecart_min) || ' min après lui, le reclassement en cause locale était une '
         || 'erreur du balayage (délai de grâce absent).',
       updated_at = now()
  FROM reparation_avals r
  JOIN coupures_reseau cr ON cr.id = r.racine_id
  JOIN sites sr ON sr.id = cr.site_id
 WHERE c.id = r.aval_id
   AND r.nb_candidats = 1
   AND r.aval_fin IS NOT NULL
   AND r.ecart_min BETWEEN 0 AND :fenetre
   -- Idempotent : une ligne déjà rattachée n'est plus candidate.
   AND c.coupure_origine_id IS NULL;
\echo '── ÉCRIT (transaction validée) ────────────────────────────────────────'
\else
\echo '── ESSAI À BLANC : rien écrit. Ajouter -v appliquer=1 pour écrire. ────'
\endif

COMMIT;
