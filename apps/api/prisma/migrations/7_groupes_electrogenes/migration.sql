-- Table des groupes électrogènes (un site peut en avoir plusieurs)
CREATE TABLE "groupes_electrogenes" (
  "id" TEXT NOT NULL,
  "site_id" TEXT NOT NULL,
  "numero" INTEGER NOT NULL,
  "puissance_kva" DECIMAL(6,2) NOT NULL DEFAULT 0,
  "statut" "StatutGE" NOT NULL DEFAULT 'GE_SECOURS',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "groupes_electrogenes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "groupes_electrogenes_site_id_numero_key" ON "groupes_electrogenes"("site_id","numero");
CREATE INDEX "groupes_electrogenes_site_id_idx" ON "groupes_electrogenes"("site_id");
ALTER TABLE "groupes_electrogenes" ADD CONSTRAINT "groupes_electrogenes_site_id_fkey"
  FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Lien relevé énergie → GE
ALTER TABLE "releves_energie" ADD COLUMN "groupe_id" TEXT;
CREATE INDEX "releves_energie_groupe_id_idx" ON "releves_energie"("groupe_id");
ALTER TABLE "releves_energie" ADD CONSTRAINT "releves_energie_groupe_id_fkey"
  FOREIGN KEY ("groupe_id") REFERENCES "groupes_electrogenes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill : un GE #1 par site qui a un GE
INSERT INTO "groupes_electrogenes" ("id","site_id","numero","puissance_kva","statut","is_active","created_at","updated_at")
SELECT gen_random_uuid(), s."id", 1, s."puissance_ge_kva", s."statut_ge", true, now(), now()
FROM "sites" s
WHERE s."statut_ge" <> 'PAS_DE_GE';

-- Rattacher l'historique des relevés GE au GE #1 (continuité des calculs)
UPDATE "releves_energie" r
SET "groupe_id" = g."id"
FROM "groupes_electrogenes" g
WHERE r."site_id" = g."site_id" AND g."numero" = 1 AND r."source" = 'GE' AND r."groupe_id" IS NULL;
