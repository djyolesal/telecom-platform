-- Phase d'une photo d'intervention : AVANT (état des lieux au démarrage) ou
-- APRES (preuves à la clôture). NULL = photos historiques, non phasées.
ALTER TABLE "photos" ADD COLUMN "phase" VARCHAR(10);
