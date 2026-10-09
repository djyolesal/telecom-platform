-- Zones de maintenance : découpage TERRAIN du parc (LOME 1, KARA…), distinct
-- des lots (découpage du CONTRAT). Chaque zone a un responsable (FME, agent
-- prestataire) pris parmi les contacts SMS ; chaque site appartient à une zone.
-- Remplies par l'import Administration → Zones de maintenance.

CREATE TABLE "zones_maintenance" (
  "id" TEXT NOT NULL,
  "nom" VARCHAR(60) NOT NULL,
  "responsable_contact_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "zones_maintenance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "zones_maintenance_responsable_contact_id_fkey" FOREIGN KEY ("responsable_contact_id")
    REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "zones_maintenance_nom_key" ON "zones_maintenance"("nom");
CREATE INDEX "zones_maintenance_responsable_contact_id_idx" ON "zones_maintenance"("responsable_contact_id");

ALTER TABLE "sites" ADD COLUMN "zone_maintenance_id" TEXT;
ALTER TABLE "sites" ADD CONSTRAINT "sites_zone_maintenance_id_fkey" FOREIGN KEY ("zone_maintenance_id")
  REFERENCES "zones_maintenance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "sites_zone_maintenance_id_idx" ON "sites"("zone_maintenance_id");
