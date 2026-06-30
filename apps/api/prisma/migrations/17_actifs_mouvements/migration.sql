-- Suivi d'actifs déplaçables (GE, batteries, climatiseurs) + travaux de cycle de vie

-- Enums
CREATE TYPE "StatutActif" AS ENUM ('EN_SERVICE', 'EN_STOCK', 'EN_TRANSIT', 'REFORME');
CREATE TYPE "NatureTravaux" AS ENUM ('ENTRETIEN', 'INSTALLATION', 'DESINSTALLATION', 'DEPLACEMENT');

-- GroupeElectrogene : identité d'actif + site nullable + FK SetNull
ALTER TABLE "groupes_electrogenes" ADD COLUMN "numero_serie" TEXT;
ALTER TABLE "groupes_electrogenes" ADD COLUMN "statut_actif" "StatutActif" NOT NULL DEFAULT 'EN_SERVICE';
ALTER TABLE "groupes_electrogenes" ALTER COLUMN "site_id" DROP NOT NULL;
CREATE UNIQUE INDEX "groupes_electrogenes_numero_serie_key" ON "groupes_electrogenes"("numero_serie");
ALTER TABLE "groupes_electrogenes" DROP CONSTRAINT "groupes_electrogenes_site_id_fkey";
ALTER TABLE "groupes_electrogenes" ADD CONSTRAINT "groupes_electrogenes_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- EquipementActif : batteries, climatiseurs…
CREATE TABLE "equipements_actifs" (
    "id" TEXT NOT NULL,
    "categorie" "CategorieEquipement" NOT NULL,
    "numero_serie" TEXT,
    "libelle" TEXT,
    "valeur" DECIMAL(10,2),
    "unite" VARCHAR(10),
    "statut_actif" "StatutActif" NOT NULL DEFAULT 'EN_SERVICE',
    "site_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "equipements_actifs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "equipements_actifs_numero_serie_key" ON "equipements_actifs"("numero_serie");
CREATE INDEX "equipements_actifs_site_id_idx" ON "equipements_actifs"("site_id");
CREATE INDEX "equipements_actifs_categorie_idx" ON "equipements_actifs"("categorie");
ALTER TABLE "equipements_actifs" ADD CONSTRAINT "equipements_actifs_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Maintenance : travaux de cycle de vie d'un actif
ALTER TABLE "maintenances" ADD COLUMN "nature_travaux" "NatureTravaux" NOT NULL DEFAULT 'ENTRETIEN';
ALTER TABLE "maintenances" ADD COLUMN "actif_type" VARCHAR(20);
ALTER TABLE "maintenances" ADD COLUMN "actif_id" TEXT;
ALTER TABLE "maintenances" ADD COLUMN "site_source_id" TEXT;
