-- Type de la liaison de transmission vers le site amont (FIBER, TN, ML, RTN…).
-- Le référentiel (libellé, famille fibre/FH, constructeur) vit dans SystemSettings.
ALTER TABLE "sites" ADD COLUMN "type_liaison" TEXT;
