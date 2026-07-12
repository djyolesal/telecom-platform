-- ════════════════════════════════════════════════════════════════════════
-- RESYNCHRONISATION DE _prisma_migrations APRÈS RENOMMAGE ZÉRO-PADÉ
-- ════════════════════════════════════════════════════════════════════════
--
-- CONTEXTE : les dossiers de migration ont été renommés de « 19_vidange_ge »
-- vers « 0019_vidange_ge » pour que l'ordre lexicographique (celui que Prisma
-- applique) corresponde enfin à l'ordre chronologique. Sans ce correctif, une
-- reconstruction sur base vierge appliquait 10_..21_ AVANT 1_..9_ et échouait.
--
-- La colonne _prisma_migrations.migration_name contient l'ANCIEN nom de dossier.
-- Ce script le met à jour vers le nouveau nom, pour que « prisma migrate deploy »
-- reconnaisse les migrations comme DÉJÀ APPLIQUÉES et ne rejoue rien.
--
-- À EXÉCUTER UNE SEULE FOIS sur la base de PRODUCTION, juste après le git pull
-- qui apporte les dossiers renommés, AVANT tout « prisma migrate deploy » :
--
--   docker compose exec postgres sh -c \
--     'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f -' < apps/api/prisma/migrations/RESYNC_PROD.sql
--
-- (ou copiez le contenu dans psql). Idempotent : réexécuter ne fait rien de plus.
-- ════════════════════════════════════════════════════════════════════════

UPDATE "_prisma_migrations" SET migration_name = '0000_init'                       WHERE migration_name = '0_init';
UPDATE "_prisma_migrations" SET migration_name = '0001_prestataires'               WHERE migration_name = '1_prestataires';
UPDATE "_prisma_migrations" SET migration_name = '0002_extensions'                 WHERE migration_name = '2_extensions';
UPDATE "_prisma_migrations" SET migration_name = '0003_releve_maintenance'         WHERE migration_name = '3_releve_maintenance';
UPDATE "_prisma_migrations" SET migration_name = '0004_sites_infra'                WHERE migration_name = '4_sites_infra';
UPDATE "_prisma_migrations" SET migration_name = '0005_tache_preventive'           WHERE migration_name = '5_tache_preventive';
UPDATE "_prisma_migrations" SET migration_name = '0006_releve_calcul'              WHERE migration_name = '6_releve_calcul';
UPDATE "_prisma_migrations" SET migration_name = '0007_groupes_electrogenes'       WHERE migration_name = '7_groupes_electrogenes';
UPDATE "_prisma_migrations" SET migration_name = '0008_prestataire_fiche'          WHERE migration_name = '8_prestataire_fiche';
UPDATE "_prisma_migrations" SET migration_name = '0009_prestataire_logo'           WHERE migration_name = '9_prestataire_logo';
UPDATE "_prisma_migrations" SET migration_name = '0010_prestataire_drop_contact'   WHERE migration_name = '10_prestataire_drop_contact';
UPDATE "_prisma_migrations" SET migration_name = '0011_maintenance_analyse'        WHERE migration_name = '11_maintenance_analyse';
UPDATE "_prisma_migrations" SET migration_name = '0012_carburant_logistique'       WHERE migration_name = '12_carburant_logistique';
UPDATE "_prisma_migrations" SET migration_name = '0013_carburant_roles_signatures' WHERE migration_name = '13_carburant_roles_signatures';
UPDATE "_prisma_migrations" SET migration_name = '0014_bl_brouillon'               WHERE migration_name = '14_bl_brouillon';
UPDATE "_prisma_migrations" SET migration_name = '0015_depotage_reconciliation'    WHERE migration_name = '15_depotage_reconciliation';
UPDATE "_prisma_migrations" SET migration_name = '0016_photos_polymorphes'         WHERE migration_name = '16_photos_polymorphes';
UPDATE "_prisma_migrations" SET migration_name = '0017_actifs_mouvements'          WHERE migration_name = '17_actifs_mouvements';
UPDATE "_prisma_migrations" SET migration_name = '0018_taches_preventives_overrides' WHERE migration_name = '18_taches_preventives_overrides';
UPDATE "_prisma_migrations" SET migration_name = '0019_vidange_ge'                 WHERE migration_name = '19_vidange_ge';
UPDATE "_prisma_migrations" SET migration_name = '0020_site_gardiennage_marque_ge' WHERE migration_name = '20_site_gardiennage_marque_ge';
UPDATE "_prisma_migrations" SET migration_name = '0021_types_pylone'               WHERE migration_name = '21_types_pylone';

-- Vérification : doit renvoyer 0 (plus aucun ancien nom non-padé).
SELECT count(*) AS restants_a_corriger
FROM "_prisma_migrations"
WHERE migration_name ~ '^[0-9]{1,3}_';
