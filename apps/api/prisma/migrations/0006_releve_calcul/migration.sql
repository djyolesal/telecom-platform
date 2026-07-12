-- Calcul auto des consommations : index horaire GE + gasoil consommé
ALTER TABLE "releves_energie"
  ADD COLUMN "index_heures_ge" DECIMAL(10,1),
  ADD COLUMN "gasoil_consomme_litres" DECIMAL(8,2);
