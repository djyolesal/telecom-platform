-- Coordonnées prestataire pour l'en-tête de la fiche de validation
ALTER TABLE "prestataires"
  ADD COLUMN "adresse" VARCHAR(200),
  ADD COLUMN "rccm" VARCHAR(60),
  ADD COLUMN "nif" VARCHAR(40),
  ADD COLUMN "contact_commercial" VARCHAR(60),
  ADD COLUMN "contact_technique" VARCHAR(60);
