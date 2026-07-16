-- Prestataires de gardiennage : type dédié + lien normalisé site → société,
-- et déclaration « agent présent » à la clôture des interventions.
ALTER TABLE "prestataires" ADD COLUMN "is_gardiennage" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "sites" ADD COLUMN "gardiennage_prestataire_id" TEXT;
CREATE INDEX "sites_gardiennage_prestataire_id_idx" ON "sites"("gardiennage_prestataire_id");
ALTER TABLE "sites" ADD CONSTRAINT "sites_gardiennage_prestataire_id_fkey"
  FOREIGN KEY ("gardiennage_prestataire_id") REFERENCES "prestataires"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "maintenances" ADD COLUMN "agent_present" BOOLEAN;
ALTER TABLE "incidents" ADD COLUMN "agent_present" BOOLEAN;
