-- Certificat de jaugeage des citernes (métrologie légale).
-- C'est la pièce qui rend le volume chargé opposable : le bordereau s'appuie
-- sur le barème des compartiments. L'échéance est suivie pour alerter AVANT
-- expiration — un certificat périmé rend l'annoncé contestable en litige.
ALTER TABLE "vehicules"
  ADD COLUMN IF NOT EXISTS "certificat_jaugeage_path" TEXT,
  ADD COLUMN IF NOT EXISTS "certificat_jaugeage_numero" VARCHAR(60),
  ADD COLUMN IF NOT EXISTS "certificat_jaugeage_expiration" TIMESTAMP(3);
