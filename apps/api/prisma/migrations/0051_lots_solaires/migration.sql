-- Les lots SOLAIRES découpent le parc différemment des lots passifs : un site
-- porte donc DEUX rattachements — son lot passif/actif (lot_id, existant) et
-- son lot solaire (lot_solaire_id, nouveau). Les attributions de scope SOLAIRE
-- se posent sur les lots solaires. Un lot est typé par son contrat.
ALTER TABLE "lots" ADD COLUMN "contrat" VARCHAR(15) NOT NULL DEFAULT 'PASSIF_ACTIF';
ALTER TABLE "sites" ADD COLUMN "lot_solaire_id" TEXT;
ALTER TABLE "sites" ADD CONSTRAINT "sites_lot_solaire_id_fkey" FOREIGN KEY ("lot_solaire_id")
  REFERENCES "lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "sites_lot_solaire_id_idx" ON "sites"("lot_solaire_id");
