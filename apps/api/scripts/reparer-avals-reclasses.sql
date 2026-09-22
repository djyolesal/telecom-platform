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
--     transmission — le nom ne sert JAMAIS à chercher un site, seulement à
--     départager deux ancêtres du même site (là, aucun homonyme possible) ;
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
  -- La trace nomme le site amont ET la minute de son rétablissement :
  -- « [RECLASSÉE] L'amont KOUNTOIRE est rétabli le 20/09 14:03 ; … »
  SELECT c.id, c.site_id, c.date_debut, c.date_fin, c.observations,
         regexp_match(c.observations,
           'L''amont (.+?) est rétabli le (\d{2})/(\d{2}) (\d{2}):(\d{2})') AS t
    FROM coupures_reseau c
   WHERE c.origine = 'LOCALE'
     AND c.coupure_origine_id IS NULL
     AND c.observations LIKE '%[RECLASSÉE]%'
),
horodatees AS (
  -- L'année n'est pas dans la trace : celle du début de la coupure, +1 an si
  -- la coupure chevauche le 31 décembre.
  SELECT s.id, s.site_id, s.date_debut, s.date_fin,
         btrim(s.t[1]) AS nom_trace,
         CASE WHEN brut < s.date_debut THEN brut + interval '1 year' ELSE brut END AS minute_amont
    FROM suspectes s,
         LATERAL (SELECT make_timestamp(EXTRACT(YEAR FROM s.date_debut)::int,
                                        s.t[3]::int, s.t[2]::int,
                                        s.t[4]::int, s.t[5]::int, 0) AS brut) b
   WHERE s.t IS NOT NULL
),
candidats AS (
  SELECT h.id AS aval_id, h.site_id AS aval_site, h.date_fin AS aval_fin,
         r.id AS racine_id, r.date_fin AS racine_fin, sa.nom AS racine_nom,
         r.technologie AS racine_techno, a.saut,
         -- DÉPARTAGE. Une même panne ferme souvent l'amont direct ET le sien à
         -- la même minute (clôture en cascade) : deux ancêtres candidats pour
         -- la même trace. Deux règles, dans cet ordre :
         --   1. le nom inscrit dans la trace — c'est LE site auquel cet aval
         --      était rattaché, la plateforme l'y a écrit elle-même ;
         --   2. à défaut (site renommé depuis), l'amont le plus HAUT de la
         --      chaîne : c'est la règle qu'applique le classement automatique
         --      (« le plus haut gagne », syncOss.controller).
         (upper(btrim(sa.nom)) = upper(h.nom_trace)) AS nom_concorde
    FROM horodatees h
    JOIN amonts a ON a.site_id = h.site_id
    JOIN coupures_reseau r
      ON r.site_id = a.amont_id
     AND r.id <> h.id
     AND r.date_fin >= h.minute_amont
     AND r.date_fin <  h.minute_amont + interval '1 minute'
    JOIN sites sa ON sa.id = r.site_id
),
classes AS (
  SELECT c.*,
         row_number() OVER (PARTITION BY c.aval_id
                            ORDER BY c.nom_concorde DESC, c.saut DESC) AS rang,
         -- Combien de candidats restent à ÉGALITÉ parfaite avec le meilleur :
         -- au-delà d'un seul, on ne tranche pas.
         count(*) OVER (PARTITION BY c.aval_id, c.nom_concorde, c.saut) AS ex_aequo,
         count(*) OVER (PARTITION BY c.aval_id) AS nb_candidats
    FROM candidats c
)
SELECT c.aval_id, c.aval_site, c.aval_fin, c.racine_id, c.racine_fin, c.racine_nom,
       c.racine_techno, c.nom_concorde, c.saut, c.rang, c.nb_candidats, c.ex_aequo,
       EXTRACT(EPOCH FROM (c.aval_fin - c.racine_fin)) / 60 AS ecart_min
  FROM classes c;

-- ── Ce qui sera rattaché ────────────────────────────────────────────────────
\echo '── À RATTACHER ────────────────────────────────────────────────────────'
SELECT sa.nom AS aval, r.racine_nom AS amont,
       round(r.ecart_min) || ' min après l''amont' AS retard,
       to_char(r.racine_fin, 'DD/MM HH24:MI') AS amont_retabli,
       CASE WHEN r.nom_concorde THEN 'nom inscrit dans la trace'
            ELSE 'amont le plus haut (' || r.saut || CASE WHEN r.saut > 1 THEN ' sauts' ELSE ' saut' END || ')'
       END AS départage
  FROM reparation_avals r
  JOIN sites sa ON sa.id = r.aval_site
 WHERE r.rang = 1
   AND r.ex_aequo = 1
   AND r.aval_fin IS NOT NULL
   AND r.ecart_min BETWEEN 0 AND :fenetre
 ORDER BY sa.nom;

-- ── Ce qui est laissé tel quel, et pourquoi ────────────────────────────────
\echo '── LAISSÉ TEL QUEL ────────────────────────────────────────────────────'
SELECT sa.nom AS aval,
       CASE WHEN r.ex_aequo > 1 THEN r.ex_aequo || ' amonts à égalité'
            WHEN r.aval_fin IS NULL THEN 'encore coupé'
            WHEN r.ecart_min < 0 THEN 'rétabli AVANT son amont'
            ELSE 'rétabli ' || round(r.ecart_min) || ' min après (hors fenêtre de ' || :fenetre || ' min)'
       END AS motif,
       (SELECT string_agg(t.racine_nom || ' [' || t.racine_techno || '] à '
                          || t.saut || CASE WHEN t.saut > 1 THEN ' sauts' ELSE ' saut' END
                          || CASE WHEN t.nom_concorde THEN ', nom concordant' ELSE '' END,
                          ' · ' ORDER BY t.rang)
          FROM reparation_avals t WHERE t.aval_id = r.aval_id) AS amonts_vus
  FROM reparation_avals r
  JOIN sites sa ON sa.id = r.aval_site
 WHERE r.rang = 1
   AND NOT (r.ex_aequo = 1 AND r.aval_fin IS NOT NULL AND r.ecart_min BETWEEN 0 AND :fenetre)
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
         || '[CORRIGÉ] Rattaché à l''amont ' || r.racine_nom || ' : ce site s''est rétabli '
         || round(r.ecart_min) || ' min après lui, le reclassement en cause locale était une '
         || 'erreur du balayage (délai de grâce absent).',
       updated_at = now()
  FROM reparation_avals r
 WHERE c.id = r.aval_id
   AND r.rang = 1
   AND r.ex_aequo = 1
   AND r.aval_fin IS NOT NULL
   AND r.ecart_min BETWEEN 0 AND :fenetre
   -- Idempotent : une ligne déjà rattachée n'est plus candidate.
   AND c.coupure_origine_id IS NULL;
\echo '── ÉCRIT (transaction validée) ────────────────────────────────────────'
\else
\echo '── ESSAI À BLANC : rien écrit. Ajouter -v appliquer=1 pour écrire. ────'
\endif

COMMIT;
