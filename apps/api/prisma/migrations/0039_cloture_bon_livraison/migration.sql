-- Clôture comptable d'un bon de livraison : ventilation du reste en citerne.
-- Le reste (chargé − livré) était calculé et affiché, jamais décidé : un camion
-- rentré au dépôt avec 800 L restait un manquant perpétuel, et rien ne
-- distinguait un retour dépôt d'un siphonnage. Ces colonnes portent la décision.

ALTER TABLE "bons_livraison"
  ADD COLUMN IF NOT EXISTS "date_cloture" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cloture_par_id" TEXT,
  ADD COLUMN IF NOT EXISTS "reste_retour_depot_litres" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "reste_perte_litres" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "reste_report_litres" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "report_sur_bl_id" TEXT,
  ADD COLUMN IF NOT EXISTS "motif_cloture" TEXT,
  ADD COLUMN IF NOT EXISTS "bon_retour_path" TEXT;

-- Volumes de ventilation jamais négatifs (un « retour » négatif n'a pas de sens
-- et fausserait silencieusement le rapprochement trimestriel).
ALTER TABLE "bons_livraison" DROP CONSTRAINT IF EXISTS "bl_ventilation_positive";
ALTER TABLE "bons_livraison" ADD CONSTRAINT "bl_ventilation_positive" CHECK (
  COALESCE("reste_retour_depot_litres", 0) >= 0
  AND COALESCE("reste_perte_litres", 0) >= 0
  AND COALESCE("reste_report_litres", 0) >= 0
);

-- Un chargement ne peut pas se reporter sur lui-même.
ALTER TABLE "bons_livraison" DROP CONSTRAINT IF EXISTS "bl_report_non_circulaire";
ALTER TABLE "bons_livraison" ADD CONSTRAINT "bl_report_non_circulaire" CHECK (
  "report_sur_bl_id" IS NULL OR "report_sur_bl_id" <> "id"
);

DO $$ BEGIN
  ALTER TABLE "bons_livraison" ADD CONSTRAINT "bons_livraison_cloture_par_id_fkey"
    FOREIGN KEY ("cloture_par_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "bons_livraison" ADD CONSTRAINT "bons_livraison_report_sur_bl_id_fkey"
    FOREIGN KEY ("report_sur_bl_id") REFERENCES "bons_livraison"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "bons_livraison_date_cloture_idx" ON "bons_livraison"("date_cloture");
