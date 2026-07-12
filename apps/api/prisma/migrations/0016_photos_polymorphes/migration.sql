-- La table "photos" est polymorphe (entity_type + entity_id) : elle rattache des
-- photos à plusieurs entités (maintenance, dépotage…). La contrainte FK historique
-- forçait entity_id à référencer maintenances(id), ce qui faisait échouer toute
-- photo de dépotage (entity_id = id de dépotage → P2003 → 400 « Référence invalide »),
-- tout en laissant le dépotage enregistré (insert hors transaction) → doublons au
-- réessai de la synchro mobile. On retire la FK : l'intégrité du lien est désormais
-- portée par le couple (entity_type, entity_id) au niveau applicatif.
ALTER TABLE "photos" DROP CONSTRAINT IF EXISTS "photos_entity_id_fkey";
