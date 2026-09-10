-- Invalidation d'une maintenance clôturée par un manager/admin : la fiche
-- reste TERMINEE mais est contestée (non conforme dans les rapports, reprise
-- exigée). Champs nuls = fiche non contestée. Réversible, audité.
ALTER TABLE "maintenances" ADD COLUMN IF NOT EXISTS "invalidee_par" TEXT;
ALTER TABLE "maintenances" ADD COLUMN IF NOT EXISTS "invalidee_le" TIMESTAMP(3);
ALTER TABLE "maintenances" ADD COLUMN IF NOT EXISTS "motif_invalidation" VARCHAR(300);
