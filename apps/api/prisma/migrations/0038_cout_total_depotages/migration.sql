-- `depotages.cout_total` n'était JAMAIS renseigné par le code, alors qu'il est
-- sommé par le rapport mensuel et imprimé dans le PDF envoyé à la direction :
-- celui-ci affichait « Coût total : 0 FCFA » sur du carburant.
--
-- Rattrapage de l'historique là où le prix du litre a été saisi. Les dépotages
-- sans prix saisi restent à NULL : on ne connaît pas le prix qui s'appliquait
-- ce jour-là, et inventer un montant fausserait les comparaisons de coût.
UPDATE "depotages"
   SET "cout_total" = ROUND("volume_litres" * "prix_litre")
 WHERE "cout_total" IS NULL
   AND "prix_litre" IS NOT NULL
   AND "prix_litre" > 0;
