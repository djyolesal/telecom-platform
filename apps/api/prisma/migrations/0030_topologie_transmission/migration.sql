-- Topologie de transmission : chaque site peut dépendre d'un site AMONT pour
-- son lien (chaînes hertziennes / hubs). Une coupure amont impacte tout l'aval.
ALTER TABLE "sites" ADD COLUMN "parent_transmission_id" TEXT;
ALTER TABLE "sites" ADD CONSTRAINT "sites_parent_transmission_id_fkey"
  FOREIGN KEY ("parent_transmission_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "sites_parent_transmission_id_idx" ON "sites"("parent_transmission_id");

-- Coupures : origine LOCALE (cause racine) ou HERITEE (victime d'un amont),
-- avec lien vers la coupure racine pour la clôture en cascade et le reporting.
ALTER TABLE "coupures_reseau" ADD COLUMN "origine" VARCHAR(10) NOT NULL DEFAULT 'LOCALE';
ALTER TABLE "coupures_reseau" ADD COLUMN "coupure_origine_id" TEXT;
ALTER TABLE "coupures_reseau" ADD CONSTRAINT "coupures_reseau_coupure_origine_id_fkey"
  FOREIGN KEY ("coupure_origine_id") REFERENCES "coupures_reseau"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "coupures_reseau_coupure_origine_id_idx" ON "coupures_reseau"("coupure_origine_id");
