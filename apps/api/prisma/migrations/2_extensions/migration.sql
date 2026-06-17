-- CreateEnum
CREATE TYPE "EquipeMaintenance" AS ENUM ('PASSIVE', 'ACTIVE');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "equipe" "EquipeMaintenance",
ADD COLUMN     "prestataire_id" TEXT;

-- AlterTable
ALTER TABLE "maintenances" ADD COLUMN     "prestataire_id" TEXT;

-- CreateIndex
CREATE INDEX "users_prestataire_id_idx" ON "users"("prestataire_id");

-- CreateIndex
CREATE INDEX "maintenances_prestataire_id_idx" ON "maintenances"("prestataire_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_prestataire_id_fkey" FOREIGN KEY ("prestataire_id") REFERENCES "prestataires"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenances" ADD CONSTRAINT "maintenances_prestataire_id_fkey" FOREIGN KEY ("prestataire_id") REFERENCES "prestataires"("id") ON DELETE SET NULL ON UPDATE CASCADE;

