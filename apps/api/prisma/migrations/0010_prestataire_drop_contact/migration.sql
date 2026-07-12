-- Suppression contact/téléphone (remplacés par contact commercial/technique)
ALTER TABLE "prestataires" DROP COLUMN IF EXISTS "contact_nom", DROP COLUMN IF EXISTS "telephone";
