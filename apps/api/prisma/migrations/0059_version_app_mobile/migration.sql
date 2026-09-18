-- Version de l'application MOBILE portée par chaque compte terrain.
--
-- Additive et NULLABLE par construction : les APK déjà déployés (b40, b43)
-- n'envoient pas cette information et doivent continuer de fonctionner sans
-- rien changer. `NULL` n'est pas un trou de données, c'est un renseignement :
-- « cet appareil n'a pas encore la version qui sait se déclarer ».
--
-- Ce champ est INDICATIF. Il ne doit jamais servir à refuser une connexion :
-- un technicien en zone isolée avec un APK ancien n'a aucun moyen de se mettre
-- à jour sur place, et le bloquer le priverait de l'outil sur le terrain.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "app_version" VARCHAR(40);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "app_version_le" TIMESTAMP(3);
