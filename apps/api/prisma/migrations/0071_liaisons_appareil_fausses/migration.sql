-- LIAISONS D'APPAREIL FAUSSES POSÉES APRÈS 0066, ET VERSIONS ILLISIBLES.
--
-- La migration 0066 avait effacé les liaisons faites sur des `Build.ID`
-- (numéro de firmware, partagé par tout un modèle de téléphone). Mais le verrou
-- n'était pas réellement désarmé pour les anciens APK : les APK découpés par
-- architecture rapportent un `versionCode` décalé (b46 en arm64 = 2046, en
-- armeabi-v7a = 1046), que le serveur lisait comme un build ≥ 48. Les b46/b47
-- du terrain ont donc RE-LIÉ des modèles de téléphone après 0066 : le premier
-- technicien d'un modèle le prenait, les suivants étaient refusés.
--
-- Seul un APK b48+ envoie un UUID. Tout identifiant qui n'a pas la forme d'un
-- UUID est donc un `Build.ID` : une liaison FAUSSE, qu'on efface. Les liaisons
-- UUID (les vrais téléphones) ne sont pas touchées.
UPDATE "users"
   SET "appareil_id" = NULL,
       "appareil_label" = NULL,
       "appareil_lie_le" = NULL
 WHERE "appareil_id" IS NOT NULL
   AND "appareil_id" !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- La version enregistrée portait le décalage par architecture (« 1.8.0+2046 »).
-- On la ramène au numéro de build réel (« 1.8.0+46 ») : c'est ce que lit
-- l'administrateur pour savoir qui est encore sur un ancien APK. Garde sur la
-- longueur : un champ libre ne doit pas faire échouer la conversion en entier.
UPDATE "users"
   SET "app_version" = split_part("app_version", '+', 1) || '+' || ((split_part("app_version", '+', 2))::int % 1000)
 WHERE "app_version" ~ '^[^+]+\+[0-9]{1,6}$'
   AND (split_part("app_version", '+', 2))::int >= 1000;
