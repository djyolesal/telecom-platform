-- Références lisibles des interventions (MNT/INC/DEP-<année>-<n>) : numéro
-- séquentiel par type et par année (compteur atomique), unique, dictable au
-- téléphone — les UUID restent les clés techniques.
CREATE TABLE "compteurs_reference" (
  "type"    VARCHAR(3) NOT NULL,
  "annee"   INTEGER    NOT NULL,
  "dernier" INTEGER    NOT NULL DEFAULT 0,
  CONSTRAINT "compteurs_reference_pkey" PRIMARY KEY ("type", "annee")
);

ALTER TABLE "maintenances" ADD COLUMN "reference" VARCHAR(20);
ALTER TABLE "incidents"    ADD COLUMN "reference" VARCHAR(20);
ALTER TABLE "depotages"    ADD COLUMN "reference" VARCHAR(20);

-- Backfill : numérotation par année de la date MÉTIER (planifiée / ouverture /
-- dépotage), dans l'ordre chronologique.
WITH n AS (
  SELECT id, EXTRACT(YEAR FROM date_planifiee)::int AS annee,
         ROW_NUMBER() OVER (PARTITION BY EXTRACT(YEAR FROM date_planifiee) ORDER BY date_planifiee, id) AS num
  FROM "maintenances")
UPDATE "maintenances" m SET "reference" = 'MNT-' || n.annee || '-' || LPAD(n.num::text, 5, '0')
FROM n WHERE m.id = n.id;

WITH n AS (
  SELECT id, EXTRACT(YEAR FROM date_ouverture)::int AS annee,
         ROW_NUMBER() OVER (PARTITION BY EXTRACT(YEAR FROM date_ouverture) ORDER BY date_ouverture, id) AS num
  FROM "incidents")
UPDATE "incidents" i SET "reference" = 'INC-' || n.annee || '-' || LPAD(n.num::text, 5, '0')
FROM n WHERE i.id = n.id;

WITH n AS (
  SELECT id, EXTRACT(YEAR FROM date_depotage)::int AS annee,
         ROW_NUMBER() OVER (PARTITION BY EXTRACT(YEAR FROM date_depotage) ORDER BY date_depotage, id) AS num
  FROM "depotages")
UPDATE "depotages" d SET "reference" = 'DEP-' || n.annee || '-' || LPAD(n.num::text, 5, '0')
FROM n WHERE d.id = n.id;

-- Compteurs initialisés au max attribué par type/année.
INSERT INTO "compteurs_reference" ("type", "annee", "dernier")
SELECT 'MNT', EXTRACT(YEAR FROM date_planifiee)::int, COUNT(*) FROM "maintenances" GROUP BY 2;
INSERT INTO "compteurs_reference" ("type", "annee", "dernier")
SELECT 'INC', EXTRACT(YEAR FROM date_ouverture)::int, COUNT(*) FROM "incidents" GROUP BY 2;
INSERT INTO "compteurs_reference" ("type", "annee", "dernier")
SELECT 'DEP', EXTRACT(YEAR FROM date_depotage)::int, COUNT(*) FROM "depotages" GROUP BY 2;

CREATE UNIQUE INDEX "maintenances_reference_key" ON "maintenances"("reference");
CREATE UNIQUE INDEX "incidents_reference_key"    ON "incidents"("reference");
CREATE UNIQUE INDEX "depotages_reference_key"    ON "depotages"("reference");
