-- Postes de gardiennage DE NUIT uniquement (à partir de 18h GMT typiquement).
-- Sans ce marquage, un passage de jour sur ces sites comptait « agent absent »
-- et pénalisait injustement la société dans le taux d'absence du rapport
-- gardiennage. La plage horaire elle-même est un paramètre système
-- (gardiennage.nuitDebutHeure / nuitFinHeure).
ALTER TABLE "sites"
  ADD COLUMN IF NOT EXISTS "gardiennage_nuit_seulement" BOOLEAN NOT NULL DEFAULT false;
