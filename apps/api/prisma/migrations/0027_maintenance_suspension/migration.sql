-- Suspension d'une maintenance en cours (urgence sur un autre site) : le
-- technicien suspend avec motif, intervient ailleurs, puis reprend (GPS sur
-- site). Le temps suspendu est décompté de la durée travaillée.
ALTER TYPE "StatutMaintenance" ADD VALUE IF NOT EXISTS 'SUSPENDUE';

ALTER TABLE "maintenances" ADD COLUMN "duree_suspendue_minutes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "maintenances" ADD COLUMN "date_suspension" TIMESTAMP(3);
ALTER TABLE "maintenances" ADD COLUMN "motif_suspension" VARCHAR(200);
