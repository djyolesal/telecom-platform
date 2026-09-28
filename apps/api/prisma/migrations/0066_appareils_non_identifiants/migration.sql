-- LIAISONS D'APPAREIL À REFAIRE : ce qui est en base ne désigne aucun téléphone.
--
-- Jusqu'à l'APK b47, l'application envoyait `Build.ID` d'Android comme
-- identifiant d'appareil. Ce n'est pas l'identité du téléphone, c'est le numéro
-- du FIRMWARE : tous les exemplaires d'un même modèle, sortis de la même
-- version d'Android, portent exactement la même valeur. D'où des « appareils »
-- comptant jusqu'à treize titulaires.
--
-- Ces valeurs ne sont donc pas des liaisons affaiblies, ce sont des liaisons
-- FAUSSES : conservées, elles refuseraient la connexion à des dizaines de
-- techniciens dès l'armement du verrou bilatéral, et ne protégeraient personne.
-- On les efface. Chaque compte se reliera à son vrai téléphone à la première
-- connexion depuis b48, qui envoie un identifiant tiré au sort par appareil.
--
-- La version de l'app (app_version) n'est PAS touchée : elle reste l'inventaire
-- des téléphones à mettre à jour, et c'est justement ce qu'il faut suivre ici.
UPDATE "users"
   SET "appareil_id" = NULL,
       "appareil_label" = NULL,
       "appareil_lie_le" = NULL
 WHERE "appareil_id" IS NOT NULL;
