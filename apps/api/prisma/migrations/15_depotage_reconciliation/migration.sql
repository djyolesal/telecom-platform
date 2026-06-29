-- Réconciliation carburant au dépotage : volume dérivé de la jauge, heures GE, écarts

-- AlterTable
ALTER TABLE "depotages" ADD COLUMN "volume_annonce_litres" DECIMAL(8,2);
ALTER TABLE "depotages" ADD COLUMN "gasoil_attendu_litres" DECIMAL(8,2);
ALTER TABLE "depotages" ADD COLUMN "ecart_conso_litres" DECIMAL(8,2);
ALTER TABLE "depotages" ADD COLUMN "ecart_livraison_litres" DECIMAL(8,2);
ALTER TABLE "depotages" ADD COLUMN "analyse_depotage" TEXT;

-- CreateTable
CREATE TABLE "depotage_heures_ge" (
    "id" TEXT NOT NULL,
    "depotage_id" TEXT NOT NULL,
    "groupe_id" TEXT,
    "index_heures_ge" DECIMAL(10,2) NOT NULL,
    CONSTRAINT "depotage_heures_ge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "depotage_heures_ge_depotage_id_idx" ON "depotage_heures_ge"("depotage_id");

-- AddForeignKey
ALTER TABLE "depotage_heures_ge" ADD CONSTRAINT "depotage_heures_ge_depotage_id_fkey" FOREIGN KEY ("depotage_id") REFERENCES "depotages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "depotage_heures_ge" ADD CONSTRAINT "depotage_heures_ge_groupe_id_fkey" FOREIGN KEY ("groupe_id") REFERENCES "groupes_electrogenes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
