-- Vérification LOCALE de l'identité à la clôture (empreinte, visage ou code de
-- l'appareil). Le verrou d'appareil prouve le téléphone ; ceci prouve que son
-- porteur était là au moment de clôturer.
--
-- Non destructif : colonne ajoutée avec un défaut. Les interventions déjà
-- clôturées restent à `false` - elles n'ont pas été vérifiées, et prétendre le
-- contraire fausserait l'audit.
ALTER TABLE "maintenances"
  ADD COLUMN IF NOT EXISTS "verifiee_localement" BOOLEAN NOT NULL DEFAULT false;
