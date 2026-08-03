-- Invariants d'intégrité identifiés par l'audit d'août 2026.
-- Les index UNIQUES sont créés en mode « best effort » : si des doublons
-- préexistent, la migration échouerait — on les crée donc APRÈS dédoublonnage.

-- 1) Relevés d'énergie : un seul relevé par (site, source, groupe, date).
--    Sans cette clé, relancer l'import historique doublait consommations et CO₂.
DELETE FROM "releves_energie" a USING "releves_energie" b
  WHERE a.ctid < b.ctid
    AND a.site_id = b.site_id AND a.source = b.source AND a.date_releve = b.date_releve
    AND COALESCE(a.groupe_id, '-') = COALESCE(b.groupe_id, '-');
CREATE UNIQUE INDEX IF NOT EXISTS "releves_energie_unicite"
  ON "releves_energie" ("site_id", "source", (COALESCE("groupe_id", '-')), "date_releve");

-- 2) Dépotages : PAS d'index d'unicité sur (site, date, volume).
--    Ce tuple n'est PAS une clé métier : deux camions peuvent livrer le même
--    volume au même site le même jour (et l'import historique horodate à minuit,
--    ce qui aligne encore plus les collisions). Un DELETE de dédoublonnage
--    aurait détruit des livraisons réelles sans trace. L'idempotence de la
--    saisie repose sur l'Idempotency-Key (createDepotage) et sur la référence
--    unique DEP-AAAA-NNNNN (colonne `reference`, déjà @unique). L'idempotence
--    de l'import de masse est assurée côté applicatif (relevesImport :
--    skipDuplicates + garde de ré-import), pas par une contrainte destructrice.
--    (Aucune action SQL ici — volontairement.)

-- 3) Planning préventif : un seul ticket OUVERT par (site, tâche contractuelle).
--    Empêche les doublons de génération (deux réplicas, ou relance manuelle).
CREATE UNIQUE INDEX IF NOT EXISTS "maintenances_preventif_ouvert_unicite"
  ON "maintenances" ("site_id", "tache_preventive_key")
  WHERE "tache_preventive_key" IS NOT NULL AND "statut" IN ('PLANIFIEE', 'EN_COURS', 'SUSPENDUE');

-- 4) Bornes temporelles : une fin ne peut pas précéder un début.
ALTER TABLE "coupures_reseau" DROP CONSTRAINT IF EXISTS "coupures_reseau_fin_apres_debut";
ALTER TABLE "coupures_reseau" ADD CONSTRAINT "coupures_reseau_fin_apres_debut"
  CHECK ("date_fin" IS NULL OR "date_fin" >= "date_debut") NOT VALID;
ALTER TABLE "incidents" DROP CONSTRAINT IF EXISTS "incidents_resolution_apres_ouverture";
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_resolution_apres_ouverture"
  CHECK ("date_resolution" IS NULL OR "date_resolution" >= "date_ouverture") NOT VALID;
