-- Types d'incident : l'enum figé devient un RÉFÉRENTIEL éditable (même motif
-- que types_pylone). Les codes « système » sont créés par le code applicatif
-- (COUPURE_TOTALE par les coupures, AUTRE comme repli) : ni supprimables ni
-- désactivables.
CREATE TABLE "types_incident" (
  "code" VARCHAR(30) NOT NULL,
  "libelle" VARCHAR(80) NOT NULL,
  "actif" BOOLEAN NOT NULL DEFAULT true,
  "systeme" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "types_incident_pkey" PRIMARY KEY ("code")
);

INSERT INTO "types_incident" ("code", "libelle", "systeme") VALUES
  ('ALARME',         'Alarme',                     false),
  ('COUPURE_CEET',   'Coupure CEET',               false),
  ('COUPURE_TOTALE', 'Coupure totale',             true),
  ('PANNE_GE',       'Panne GE',                   false),
  ('PANNE_SOLAIRE',  'Panne solaire (PV/batteries/régulateur)', false),
  ('INTRUSION',      'Intrusion',                  false),
  ('VANDALISME',     'Vandalisme',                 false),
  ('AUTRE',          'Autre',                      true);

ALTER TABLE "incidents" ALTER COLUMN "type" TYPE VARCHAR(30) USING "type"::text;
DROP TYPE "TypeIncident";
