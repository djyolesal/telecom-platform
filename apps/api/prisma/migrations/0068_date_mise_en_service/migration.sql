-- DATE DE MISE EN SERVICE du site.
--
-- L'âge d'un site explique beaucoup : un pylône de 1999 ne s'entretient pas
-- comme un site de 2025, et la corrélation entre ancienneté et incidents est
-- la première question qu'on pose devant un parc qui vieillit.
--
-- DATE sans heure : on parle d'un jour de mise en service, jamais d'un instant.
-- Nullable : le parc historique n'est pas tout documenté, et une date inventée
-- vaut moins que pas de date.
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "date_mise_en_service" DATE;
CREATE INDEX IF NOT EXISTS "sites_date_mise_en_service_idx" ON "sites" ("date_mise_en_service");
