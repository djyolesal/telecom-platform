-- Logistique carburant : Bon de commande → Bon de livraison → Plan de livraison → Sites

-- CreateEnum
CREATE TYPE "StatutBonCommande" AS ENUM ('OUVERT', 'CLOTURE', 'ANNULE');
CREATE TYPE "StatutBonLivraison" AS ENUM ('PLANIFIE', 'CHARGE', 'LIVRE', 'ANNULE');
CREATE TYPE "StatutLigneLivraison" AS ENUM ('PREVU', 'PARTIEL', 'LIVRE', 'ANNULE');

-- CreateTable
CREATE TABLE "bons_commande" (
    "id" TEXT NOT NULL,
    "numero" VARCHAR(50) NOT NULL,
    "annee" INTEGER NOT NULL,
    "trimestre" INTEGER NOT NULL,
    "numero_client" VARCHAR(50) NOT NULL,
    "statut" "StatutBonCommande" NOT NULL DEFAULT 'OUVERT',
    "observations" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bons_commande_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "volumes_mensuels" (
    "id" TEXT NOT NULL,
    "bon_commande_id" TEXT NOT NULL,
    "mois" INTEGER NOT NULL,
    "volume_prevu_litres" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "volumes_mensuels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bons_livraison" (
    "id" TEXT NOT NULL,
    "bon_commande_id" TEXT NOT NULL,
    "numero_bl" VARCHAR(50) NOT NULL,
    "mois" INTEGER NOT NULL,
    "annee" INTEGER NOT NULL,
    "immatriculation" VARCHAR(30) NOT NULL,
    "volume_charge_litres" DECIMAL(12,2) NOT NULL,
    "numero_client" VARCHAR(50) NOT NULL,
    "date_chargement" TIMESTAMP(3) NOT NULL,
    "date_traitement" TIMESTAMP(3),
    "statut" "StatutBonLivraison" NOT NULL DEFAULT 'PLANIFIE',
    "observations" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bons_livraison_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lignes_livraison" (
    "id" TEXT NOT NULL,
    "bon_livraison_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "volume_prevu_litres" DECIMAL(10,2) NOT NULL,
    "volume_livre_litres" DECIMAL(10,2),
    "statut" "StatutLigneLivraison" NOT NULL DEFAULT 'PREVU',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lignes_livraison_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "depotages" ADD COLUMN "ligne_livraison_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "bons_commande_numero_key" ON "bons_commande"("numero");
CREATE INDEX "bons_commande_annee_trimestre_idx" ON "bons_commande"("annee", "trimestre");
CREATE INDEX "volumes_mensuels_bon_commande_id_idx" ON "volumes_mensuels"("bon_commande_id");
CREATE UNIQUE INDEX "volumes_mensuels_bon_commande_id_mois_key" ON "volumes_mensuels"("bon_commande_id", "mois");
CREATE UNIQUE INDEX "bons_livraison_numero_bl_key" ON "bons_livraison"("numero_bl");
CREATE INDEX "bons_livraison_bon_commande_id_idx" ON "bons_livraison"("bon_commande_id");
CREATE INDEX "bons_livraison_annee_mois_idx" ON "bons_livraison"("annee", "mois");
CREATE INDEX "lignes_livraison_bon_livraison_id_idx" ON "lignes_livraison"("bon_livraison_id");
CREATE INDEX "lignes_livraison_site_id_idx" ON "lignes_livraison"("site_id");
CREATE UNIQUE INDEX "lignes_livraison_bon_livraison_id_site_id_key" ON "lignes_livraison"("bon_livraison_id", "site_id");
CREATE INDEX "depotages_ligne_livraison_id_idx" ON "depotages"("ligne_livraison_id");

-- AddForeignKey
ALTER TABLE "volumes_mensuels" ADD CONSTRAINT "volumes_mensuels_bon_commande_id_fkey" FOREIGN KEY ("bon_commande_id") REFERENCES "bons_commande"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bons_livraison" ADD CONSTRAINT "bons_livraison_bon_commande_id_fkey" FOREIGN KEY ("bon_commande_id") REFERENCES "bons_commande"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lignes_livraison" ADD CONSTRAINT "lignes_livraison_bon_livraison_id_fkey" FOREIGN KEY ("bon_livraison_id") REFERENCES "bons_livraison"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lignes_livraison" ADD CONSTRAINT "lignes_livraison_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "depotages" ADD CONSTRAINT "depotages_ligne_livraison_id_fkey" FOREIGN KEY ("ligne_livraison_id") REFERENCES "lignes_livraison"("id") ON DELETE SET NULL ON UPDATE CASCADE;
