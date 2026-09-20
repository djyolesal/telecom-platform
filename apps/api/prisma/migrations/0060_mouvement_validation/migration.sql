-- VALIDATION DES MOUVEMENTS DE CARBURANT.
--
-- Un transfert ou une purge RETIRE du gasoil du stock attendu — donc de l'écart
-- qui déclenche les alertes de vol. Jusqu'ici ces écritures étaient saisies au
-- bureau par une seule personne, sans preuve et sans contrôle : l'opération la
-- moins prouvée de toute la chaîne carburant.
--
-- Ce statut permet deux choses à la fois :
--   - la DÉCLARATION DEPUIS LE TERRAIN (photos, GPS, signature) sans élargir le
--     droit de faire disparaître du gasoil : elle naît EN_ATTENTE, sans le
--     moindre effet sur le stock, jusqu'à validation ;
--   - la CONTRE-VALIDATION : un transfert cesse d'être une écriture unilatérale.
--
-- DEFAULT 'VALIDE' : l'existant garde exactement sa valeur comptable. Une
-- migration ne doit jamais réécrire l'histoire d'un stock déjà rapproché.
ALTER TABLE "mouvements_carburant" ADD COLUMN IF NOT EXISTS "statut" VARCHAR(12) NOT NULL DEFAULT 'VALIDE';
ALTER TABLE "mouvements_carburant" ADD COLUMN IF NOT EXISTS "valide_par_id" TEXT;
ALTER TABLE "mouvements_carburant" ADD COLUMN IF NOT EXISTS "valide_le" TIMESTAMP(3);
ALTER TABLE "mouvements_carburant" ADD COLUMN IF NOT EXISTS "signature_path" TEXT;
ALTER TABLE "mouvements_carburant" ADD COLUMN IF NOT EXISTS "motif_refus" TEXT;

-- Les sommes de stock filtrent sur le statut : l'index évite un balayage.
CREATE INDEX IF NOT EXISTS "mouvements_carburant_statut_idx" ON "mouvements_carburant"("statut");
