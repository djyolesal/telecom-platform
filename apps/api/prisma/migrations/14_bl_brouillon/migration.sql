-- Marqueur brouillon sur les bons de livraison (exclus des agrégats jusqu'à finalisation)

-- AlterTable
ALTER TABLE "bons_livraison" ADD COLUMN "is_brouillon" BOOLEAN NOT NULL DEFAULT false;

-- Backfill : les brouillons existants ont un numéro provisoire « BR-… »
UPDATE "bons_livraison" SET "is_brouillon" = true WHERE "numero_bl" LIKE 'BR-%';
