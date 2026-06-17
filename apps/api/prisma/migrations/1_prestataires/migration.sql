-- CreateEnum
CREATE TYPE "ScopeMaintenance" AS ENUM ('PASSIVE', 'ACTIVE', 'LES_DEUX');

-- AlterTable
ALTER TABLE "sites" ADD COLUMN     "lot_id" TEXT;

-- CreateTable
CREATE TABLE "prestataires" (
    "id" TEXT NOT NULL,
    "nom" VARCHAR(120) NOT NULL,
    "contact_nom" VARCHAR(100),
    "telephone" VARCHAR(20),
    "email" VARCHAR(100),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prestataires_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lots" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "nom" VARCHAR(120) NOT NULL,
    "region" VARCHAR(50),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lot_assignments" (
    "id" TEXT NOT NULL,
    "lot_id" TEXT NOT NULL,
    "prestataire_id" TEXT NOT NULL,
    "scope" "ScopeMaintenance" NOT NULL,
    "date_debut" TIMESTAMP(3),
    "date_fin" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lot_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lots_code_key" ON "lots"("code");

-- CreateIndex
CREATE INDEX "lot_assignments_prestataire_id_idx" ON "lot_assignments"("prestataire_id");

-- CreateIndex
CREATE UNIQUE INDEX "lot_assignments_lot_id_prestataire_id_scope_key" ON "lot_assignments"("lot_id", "prestataire_id", "scope");

-- CreateIndex
CREATE INDEX "sites_lot_id_idx" ON "sites"("lot_id");

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_assignments" ADD CONSTRAINT "lot_assignments_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_assignments" ADD CONSTRAINT "lot_assignments_prestataire_id_fkey" FOREIGN KEY ("prestataire_id") REFERENCES "prestataires"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

