-- Vidange GE conditionnée aux heures de marche (~250 h configurable) :
-- mémorise l'index horaire et la date de la dernière vidange confirmée sur
-- l'actif GE (suit le groupe même s'il change de site).
ALTER TABLE "groupes_electrogenes"
  ADD COLUMN "index_heures_derniere_vidange" DECIMAL(10,1),
  ADD COLUMN "date_derniere_vidange" TIMESTAMP(3);
