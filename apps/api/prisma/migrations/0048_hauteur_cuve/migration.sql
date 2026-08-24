-- Hauteur de gasoil MESURÉE (cm) stockée à côté des litres calculés : trace de
-- la mesure terrain, et recalcul possible si le barème de la cuve est corrigé.
ALTER TABLE "releves_energie" ADD COLUMN "hauteur_cuve_cm" DECIMAL(6,1);
ALTER TABLE "depotages"
  ADD COLUMN "hauteur_avant_cm" DECIMAL(6,1),
  ADD COLUMN "hauteur_apres_cm" DECIMAL(6,1);
