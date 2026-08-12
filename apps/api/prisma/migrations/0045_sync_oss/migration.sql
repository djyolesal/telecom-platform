-- Détection automatique des coupures depuis l'OSS (état connected/disconnected
-- des eNodeB). `node_id` = identifiant du site chez l'équipementier (suffixe de
-- « 615-03-Macro-XXXX ») ; `source` distingue les coupures détectées (OSS) des
-- saisies humaines — l'auto-clôture ne touche JAMAIS une coupure manuelle.
ALTER TABLE "sites"
  ADD COLUMN IF NOT EXISTS "node_id" VARCHAR(20);
CREATE UNIQUE INDEX IF NOT EXISTS "sites_node_id_key" ON "sites"("node_id") WHERE "node_id" IS NOT NULL;

ALTER TABLE "coupures_reseau"
  ADD COLUMN IF NOT EXISTS "source" VARCHAR(10) NOT NULL DEFAULT 'MANUEL';
