-- QUEL facteur a vérifié l'identité à la clôture.
--
-- « Vérifiée » ne suffit pas : le code d'écran se prête aussi facilement que le
-- téléphone lui-même, l'empreinte non. Sans cette colonne, les deux se
-- ressemblaient dans les données et l'exploitant ne pouvait pas savoir si son
-- contrôle valait quelque chose.
--
-- BIOMETRIE : empreinte ou visage. CODE : schéma/PIN de l'appareil.
-- AUCUN : appareil sans verrou d'écran (déclaré par l'application).
ALTER TABLE "maintenances"
  ADD COLUMN IF NOT EXISTS "verification_facteur" VARCHAR(12);
