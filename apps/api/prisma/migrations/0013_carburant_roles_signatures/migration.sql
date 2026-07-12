-- Rôle transporteur + PDF (BC/BL/bordereau) + signatures tripartites du dépotage

-- AlterEnum
ALTER TYPE "RoleUser" ADD VALUE 'TRANSPORTEUR';

-- AlterTable
ALTER TABLE "prestataires" ADD COLUMN "is_transporteur" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "bons_commande" ADD COLUMN "bc_pdf_path" TEXT;

-- AlterTable
ALTER TABLE "bons_livraison" ADD COLUMN "transporteur_id" TEXT;
ALTER TABLE "bons_livraison" ADD COLUMN "bl_pdf_path" TEXT;
ALTER TABLE "bons_livraison" ADD COLUMN "bordereau_pdf_path" TEXT;

-- AlterTable
ALTER TABLE "depotages" ADD COLUMN "nom_chauffeur" VARCHAR(100);
ALTER TABLE "depotages" ADD COLUMN "signature_chauffeur_path" TEXT;
ALTER TABLE "depotages" ADD COLUMN "nom_agent_securite" VARCHAR(100);
ALTER TABLE "depotages" ADD COLUMN "signature_agent_securite_path" TEXT;
ALTER TABLE "depotages" ADD COLUMN "signature_technicien_path" TEXT;

-- CreateIndex
CREATE INDEX "bons_livraison_transporteur_id_idx" ON "bons_livraison"("transporteur_id");

-- AddForeignKey
ALTER TABLE "bons_livraison" ADD CONSTRAINT "bons_livraison_transporteur_id_fkey" FOREIGN KEY ("transporteur_id") REFERENCES "prestataires"("id") ON DELETE SET NULL ON UPDATE CASCADE;
