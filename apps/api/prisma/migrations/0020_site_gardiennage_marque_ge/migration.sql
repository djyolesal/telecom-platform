-- Gardiennage + contact local du site (préparation d'intervention, corrélation
-- des manquants, responsabilité en cas de vol) et marque du GE (actif).
ALTER TABLE "sites"
  ADD COLUMN "has_gardien" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "societe_gardiennage" VARCHAR(100),
  ADD COLUMN "telephone_site" VARCHAR(30);

ALTER TABLE "groupes_electrogenes"
  ADD COLUMN "marque" VARCHAR(60);
