-- Recherche par identifiant d'appareil : à CHAQUE connexion mobile, on vérifie
-- désormais qu'aucun autre compte ne détient déjà ce téléphone.
--
-- Index NON unique à dessein : des doublons peuvent déjà exister en base (le
-- verrou ne les empêchait pas), et une contrainte unique ferait échouer la
-- migration sur un parc réel. Le refus est appliqué dans le code, et
-- l'écran d'administration liste les appareils partagés à démêler. L'unicité
-- en base viendra quand le parc sera propre.
CREATE INDEX IF NOT EXISTS "users_appareil_id_idx" ON "users" ("appareil_id");
