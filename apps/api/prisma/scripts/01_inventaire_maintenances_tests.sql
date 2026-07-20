-- ============================================================================
-- INVENTAIRE (LECTURE SEULE) — maintenances de test du 25/06/2026 au 20/07/2026
-- ----------------------------------------------------------------------------
-- Ce script NE SUPPRIME RIEN. Il montre exactement ce que la purge détruirait.
-- À exécuter AVANT 02_purge_maintenances_tests.sql, et à relire attentivement.
--
--   psql "$DATABASE_URL" -f 01_inventaire_maintenances_tests.sql
--
-- Critère retenu : la maintenance doit avoir été CRÉÉE **et** PLANIFIÉE dans la
-- fenêtre (le plus strict — évite d'emporter de vraies maintenances planifiées
-- de longue date ou créées avant les tests).
-- Bornes : 25/06/2026 inclus → 21/07/2026 exclu (donc le 20/07 est inclus).
-- ATTENTION : les colonnes sont des timestamptz ; les bornes sont interprétées
-- dans le fuseau du serveur PostgreSQL (vérifier avec : SHOW timezone;).
-- ============================================================================

\set debut '2026-06-25'
\set fin   '2026-07-21'

SHOW timezone;

-- Périmètre exact de la purge
CREATE TEMP TABLE maint_test AS
SELECT id, reference, site_id, statut, date_planifiee, created_at
FROM maintenances
WHERE created_at     >= DATE :'debut' AND created_at     < DATE :'fin'
  AND date_planifiee >= DATE :'debut' AND date_planifiee < DATE :'fin';

\echo ''
\echo '=== 1. MAINTENANCES CIBLÉES ==========================================='
SELECT count(*) AS maintenances_a_supprimer,
       min(created_at) AS premiere_creation,
       max(created_at) AS derniere_creation
FROM maint_test;

\echo ''
\echo '--- répartition par statut ---'
SELECT statut, count(*) FROM maint_test GROUP BY statut ORDER BY count(*) DESC;

\echo ''
\echo '--- 20 premières (échantillon à vérifier) ---'
SELECT m.reference, s.nom AS site, m.statut, m.date_planifiee::date, m.created_at
FROM maint_test m LEFT JOIN sites s ON s.id = m.site_id
ORDER BY m.created_at LIMIT 20;

\echo ''
\echo '=== 2. CONTRÔLE : maintenances de la période NON ciblées ==============='
\echo '(créées OU planifiées dans la fenêtre, mais pas les deux — elles SURVIVRONT)'
SELECT count(*) AS non_ciblees
FROM maintenances m
WHERE ( (m.created_at     >= DATE :'debut' AND m.created_at     < DATE :'fin')
     OR (m.date_planifiee >= DATE :'debut' AND m.date_planifiee < DATE :'fin') )
  AND m.id NOT IN (SELECT id FROM maint_test);

\echo ''
\echo '=== 3. PIÈCES DE RECHANGE (supprimées en CASCADE) ====================='
SELECT count(*) AS pieces_supprimees_en_cascade
FROM pieces_rechange WHERE maintenance_id IN (SELECT id FROM maint_test);

\echo ''
\echo '=== 4. RELEVÉS D''ÉNERGIE liés (seront supprimés) ======================'
\echo '(impact direct sur consommation, énergie et empreinte carbone)'
SELECT count(*)                              AS releves_supprimes,
       COALESCE(sum(gasoil_consomme_litres),0) AS litres_gasoil_retires,
       COALESCE(sum(consommation_kwh),0)       AS kwh_retires
FROM releves_energie WHERE maintenance_id IN (SELECT id FROM maint_test);

\echo ''
\echo '=== 5. PHOTOS (lignes + fichiers MinIO) ==============================='
SELECT count(*) AS photos_supprimees
FROM photos WHERE entity_type = 'maintenance' AND entity_id IN (SELECT id FROM maint_test);

\echo ''
\echo '=== 6. EFFET DE BORD : vidanges GE enregistrées pendant la fenêtre ====='
\echo '(la suppression NE remet PAS ces compteurs à zéro — voir étape 4 de la purge)'
SELECT count(*) AS ge_avec_vidange_dans_la_fenetre
FROM groupes_electrogenes
WHERE date_derniere_vidange >= DATE :'debut' AND date_derniere_vidange < DATE :'fin';

\echo ''
\echo '>>> Rien n''a été modifié. Relisez les chiffres, puis lancez la purge.'
\echo ''
