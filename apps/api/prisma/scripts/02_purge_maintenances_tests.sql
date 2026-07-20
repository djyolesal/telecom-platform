-- ============================================================================
-- PURGE DÉFINITIVE — maintenances de test du 25/06/2026 au 20/07/2026
-- ----------------------------------------------------------------------------
--  ⚠️  IRRÉVERSIBLE. NE PAS EXÉCUTER SANS SAUVEGARDE PRÉALABLE :
--        pg_dump "$DATABASE_URL" -Fc -f avant_purge_$(date +%F_%H%M).dump
--
--  Exécuter d'abord 01_inventaire_maintenances_tests.sql et valider les chiffres.
--
--        psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 02_purge_maintenances_tests.sql
--
--  Le tout est dans UNE transaction : la moindre erreur annule l'ensemble.
--  Le script est en mode « répétition impossible » : une fois COMMIT, c'est fait.
--
--  Ordre de suppression (contraintes obligent) :
--    1. relevés d'énergie liés   (sinon ON DELETE SET NULL les laisserait vivre)
--    2. photos                   (FK retirée en migration 0016 → orphelines sinon)
--    3. maintenances             (pieces_rechange partent en CASCADE)
--    4. (optionnel) compteurs de vidange GE faussés par les tests
-- ============================================================================

\set ON_ERROR_STOP on
\set debut '2026-06-25'
\set fin   '2026-07-21'

BEGIN;

-- Périmètre figé : créées ET planifiées dans la fenêtre.
CREATE TEMP TABLE maint_test AS
SELECT id FROM maintenances
WHERE created_at     >= DATE :'debut' AND created_at     < DATE :'fin'
  AND date_planifiee >= DATE :'debut' AND date_planifiee < DATE :'fin';

\echo '--- maintenances ciblées :'
SELECT count(*) FROM maint_test;

-- ---------------------------------------------------------------------------
-- 0) EXPORT des clés MinIO AVANT suppression (sinon elles sont perdues et les
--    fichiers resteraient orphelins dans le stockage objet, sans référence).
-- ---------------------------------------------------------------------------
\copy (SELECT minio_key FROM photos WHERE entity_type = 'maintenance' AND entity_id IN (SELECT id FROM maint_test)) TO 'photos_minio_a_supprimer.txt'

-- ---------------------------------------------------------------------------
-- 1) Relevés d'énergie saisis lors de ces maintenances
-- ---------------------------------------------------------------------------
DELETE FROM releves_energie WHERE maintenance_id IN (SELECT id FROM maint_test);

-- ---------------------------------------------------------------------------
-- 2) Photos (table polymorphe, aucune FK → suppression explicite)
-- ---------------------------------------------------------------------------
DELETE FROM photos WHERE entity_type = 'maintenance' AND entity_id IN (SELECT id FROM maint_test);

-- ---------------------------------------------------------------------------
-- 3) Maintenances — pieces_rechange suivent en ON DELETE CASCADE
-- ---------------------------------------------------------------------------
DELETE FROM maintenances WHERE id IN (SELECT id FROM maint_test);

-- ---------------------------------------------------------------------------
-- 4) OPTIONNEL — compteurs de vidange GE écrits par les clôtures de test.
--    La suppression d'une maintenance ne les rétracte PAS : un GE peut donc
--    garder une « dernière vidange » fictive et voir son alerte des 250 h
--    faussement repoussée. Décommentez SEULEMENT si ces vidanges étaient des
--    tests (vérifiez d'abord le décompte de l'étape 6 de l'inventaire).
-- ---------------------------------------------------------------------------
-- UPDATE groupes_electrogenes
--    SET index_heures_derniere_vidange = NULL, date_derniere_vidange = NULL
--  WHERE date_derniere_vidange >= DATE :'debut' AND date_derniere_vidange < DATE :'fin';

\echo '--- restant dans la fenêtre (doit être 0) :'
SELECT count(*) FROM maintenances
WHERE created_at     >= DATE :'debut' AND created_at     < DATE :'fin'
  AND date_planifiee >= DATE :'debut' AND date_planifiee < DATE :'fin';

-- ⚠️ Relisez les chiffres ci-dessus. Pour ANNULER : remplacez COMMIT par ROLLBACK.
COMMIT;

\echo ''
\echo '>>> Purge terminée. Reste à supprimer les fichiers dans MinIO :'
\echo '    while read -r k; do mc rm "PROFIL/$MINIO_BUCKET/$k"; done < photos_minio_a_supprimer.txt'
\echo ''
