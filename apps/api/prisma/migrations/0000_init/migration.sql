-- CreateEnum
CREATE TYPE "PowerConfig" AS ENUM ('CEET_GE', 'CEET_UNIQUEMENT', 'GE_UNIQUEMENT', 'HYBRIDE_GE', 'SOLAIRE_UNIQUEMENT', 'HYBRIDE_CEET_GE');

-- CreateEnum
CREATE TYPE "StatutGE" AS ENUM ('GE_PERMANENT', 'GE_SECOURS', 'PAS_DE_GE');

-- CreateEnum
CREATE TYPE "RoleUser" AS ENUM ('TECHNICIEN', 'SUPERVISEUR', 'MANAGER', 'ADMIN', 'DIRECTION');

-- CreateEnum
CREATE TYPE "TypeMaintenance" AS ENUM ('PREVENTIVE', 'CURATIVE');

-- CreateEnum
CREATE TYPE "StatutMaintenance" AS ENUM ('PLANIFIEE', 'EN_COURS', 'TERMINEE', 'ANNULEE');

-- CreateEnum
CREATE TYPE "CategorieEquipement" AS ENUM ('GE', 'BATTERIE', 'CLIMATISEUR', 'ANTENNE', 'CABLE', 'RESEAU', 'AUTRE');

-- CreateEnum
CREATE TYPE "SourceEnergie" AS ENUM ('CEET', 'GE', 'SOLAIRE');

-- CreateEnum
CREATE TYPE "TypeIncident" AS ENUM ('ALARME', 'COUPURE_CEET', 'COUPURE_TOTALE', 'PANNE_GE', 'INTRUSION', 'VANDALISME', 'AUTRE');

-- CreateEnum
CREATE TYPE "NiveauSeverite" AS ENUM ('CRITIQUE', 'MAJEUR', 'MINEUR', 'INFORMATIF');

-- CreateEnum
CREATE TYPE "StatutIncident" AS ENUM ('OUVERT', 'EN_COURS', 'RESOLU', 'CLOS');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'EXPORT', 'ASSIGN', 'CLOSE');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "nom" VARCHAR(50) NOT NULL,
    "prenom" VARCHAR(50) NOT NULL,
    "email" VARCHAR(100) NOT NULL,
    "telephone" VARCHAR(20),
    "role" "RoleUser" NOT NULL,
    "region" VARCHAR(50),
    "password_hash" TEXT NOT NULL,
    "fcm_token" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sites" (
    "id" TEXT NOT NULL,
    "nom" VARCHAR(100) NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "region" VARCHAR(50) NOT NULL,
    "ville" VARCHAR(50),
    "adresse" TEXT,
    "latitude" DECIMAL(10,8),
    "longitude" DECIMAL(11,8),
    "power_config" "PowerConfig" NOT NULL,
    "statut_ge" "StatutGE" NOT NULL,
    "puissance_ge_kva" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenances" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "incident_id" TEXT,
    "type" "TypeMaintenance" NOT NULL,
    "categorie" "CategorieEquipement" NOT NULL,
    "equipement" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "statut" "StatutMaintenance" NOT NULL DEFAULT 'PLANIFIEE',
    "date_planifiee" TIMESTAMP(3) NOT NULL,
    "date_debut" TIMESTAMP(3),
    "date_fin" TIMESTAMP(3),
    "duree_minutes" INTEGER,
    "technicien_id" TEXT,
    "signature_path" TEXT,
    "rapport_pdf_path" TEXT,
    "observations" TEXT,
    "latitude_debut" DECIMAL(10,8),
    "longitude_debut" DECIMAL(11,8),
    "is_synced" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pieces_rechange" (
    "id" TEXT NOT NULL,
    "maintenance_id" TEXT NOT NULL,
    "nom" VARCHAR(100) NOT NULL,
    "reference" VARCHAR(50),
    "quantite" INTEGER NOT NULL,
    "cout_unitaire" DECIMAL(10,2),

    CONSTRAINT "pieces_rechange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "photos" (
    "id" TEXT NOT NULL,
    "entity_type" VARCHAR(30) NOT NULL,
    "entity_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "minio_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "depotages" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "date_depotage" TIMESTAMP(3) NOT NULL,
    "volume_litres" DECIMAL(8,2) NOT NULL,
    "stock_avant_litres" DECIMAL(8,2),
    "stock_apres_litres" DECIMAL(8,2),
    "fournisseur" VARCHAR(100),
    "numero_bon_livraison" VARCHAR(50),
    "prix_litre" DECIMAL(6,0),
    "cout_total" DECIMAL(12,0),
    "technicien_id" TEXT,
    "signature_path" TEXT,
    "bon_livraison_path" TEXT,
    "observations" TEXT,
    "latitude" DECIMAL(10,8),
    "longitude" DECIMAL(11,8),
    "is_synced" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "depotages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "releves_energie" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "date_releve" TIMESTAMP(3) NOT NULL,
    "source" "SourceEnergie" NOT NULL,
    "index_compteur" DECIMAL(10,2),
    "consommation_kwh" DECIMAL(10,2),
    "volume_gasoil_litres" DECIMAL(8,2),
    "heures_fonct_ge" DECIMAL(8,1),
    "puissance_kva" DECIMAL(6,2),
    "cout_estime" DECIMAL(12,0),
    "technicien_id" TEXT,
    "observations" TEXT,
    "latitude" DECIMAL(10,8),
    "longitude" DECIMAL(11,8),
    "is_synced" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "releves_energie_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "type" "TypeIncident" NOT NULL,
    "severite" "NiveauSeverite" NOT NULL,
    "statut" "StatutIncident" NOT NULL DEFAULT 'OUVERT',
    "description" TEXT NOT NULL,
    "date_ouverture" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date_intervention" TIMESTAMP(3),
    "date_resolution" TIMESTAMP(3),
    "delai_intervention_minutes" INTEGER,
    "duree_coupure_minutes" INTEGER,
    "technicien_id" TEXT,
    "declare_par" TEXT,
    "cause_probable" TEXT,
    "action_corrective" TEXT,
    "signature_path" TEXT,
    "latitude" DECIMAL(10,8),
    "longitude" DECIMAL(11,8),
    "is_synced" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "resource" VARCHAR(50) NOT NULL,
    "resource_id" TEXT,
    "details" JSONB,
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" TEXT NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sites_code_key" ON "sites"("code");

-- CreateIndex
CREATE INDEX "sites_region_idx" ON "sites"("region");

-- CreateIndex
CREATE INDEX "sites_statut_ge_idx" ON "sites"("statut_ge");

-- CreateIndex
CREATE INDEX "sites_power_config_idx" ON "sites"("power_config");

-- CreateIndex
CREATE INDEX "maintenances_site_id_idx" ON "maintenances"("site_id");

-- CreateIndex
CREATE INDEX "maintenances_technicien_id_idx" ON "maintenances"("technicien_id");

-- CreateIndex
CREATE INDEX "maintenances_date_planifiee_idx" ON "maintenances"("date_planifiee");

-- CreateIndex
CREATE INDEX "maintenances_statut_idx" ON "maintenances"("statut");

-- CreateIndex
CREATE INDEX "photos_entity_type_entity_id_idx" ON "photos"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "depotages_site_id_idx" ON "depotages"("site_id");

-- CreateIndex
CREATE INDEX "depotages_date_depotage_idx" ON "depotages"("date_depotage");

-- CreateIndex
CREATE INDEX "releves_energie_site_id_idx" ON "releves_energie"("site_id");

-- CreateIndex
CREATE INDEX "releves_energie_date_releve_idx" ON "releves_energie"("date_releve");

-- CreateIndex
CREATE INDEX "releves_energie_source_idx" ON "releves_energie"("source");

-- CreateIndex
CREATE INDEX "incidents_site_id_idx" ON "incidents"("site_id");

-- CreateIndex
CREATE INDEX "incidents_statut_idx" ON "incidents"("statut");

-- CreateIndex
CREATE INDEX "incidents_severite_idx" ON "incidents"("severite");

-- CreateIndex
CREATE INDEX "incidents_date_ouverture_idx" ON "incidents"("date_ouverture");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_resource_idx" ON "audit_logs"("resource");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_key_key" ON "system_settings"("key");

-- CreateIndex
CREATE INDEX "notifications_user_id_is_read_idx" ON "notifications"("user_id", "is_read");

-- AddForeignKey
ALTER TABLE "maintenances" ADD CONSTRAINT "maintenances_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenances" ADD CONSTRAINT "maintenances_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenances" ADD CONSTRAINT "maintenances_technicien_id_fkey" FOREIGN KEY ("technicien_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pieces_rechange" ADD CONSTRAINT "pieces_rechange_maintenance_id_fkey" FOREIGN KEY ("maintenance_id") REFERENCES "maintenances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "maintenances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depotages" ADD CONSTRAINT "depotages_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depotages" ADD CONSTRAINT "depotages_technicien_id_fkey" FOREIGN KEY ("technicien_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "releves_energie" ADD CONSTRAINT "releves_energie_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "releves_energie" ADD CONSTRAINT "releves_energie_technicien_id_fkey" FOREIGN KEY ("technicien_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_technicien_id_fkey" FOREIGN KEY ("technicien_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_declare_par_fkey" FOREIGN KEY ("declare_par") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

