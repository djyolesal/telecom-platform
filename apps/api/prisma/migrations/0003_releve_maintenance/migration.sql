-- AlterTable
ALTER TABLE "releves_energie" ADD COLUMN     "maintenance_id" TEXT;

-- CreateIndex
CREATE INDEX "releves_energie_maintenance_id_idx" ON "releves_energie"("maintenance_id");

-- AddForeignKey
ALTER TABLE "releves_energie" ADD CONSTRAINT "releves_energie_maintenance_id_fkey" FOREIGN KEY ("maintenance_id") REFERENCES "maintenances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

