-- Types de pylône : référentiel éditable (table) au lieu d'un enum figé,
-- pour que l'admin puisse ajouter/modifier les types depuis le web.
CREATE TABLE "types_pylone" (
  "code"       VARCHAR(40) NOT NULL,
  "libelle"    VARCHAR(80) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "types_pylone_pkey" PRIMARY KEY ("code")
);

INSERT INTO "types_pylone" ("code", "libelle") VALUES
  ('GREENFIELD',         'Greenfield'),
  ('ROOFTOP',            'Rooftop'),
  ('TGC_GREENFIELD',     'TGC-Greenfield'),
  ('TROTTOIR',           'Trottoir'),
  ('RURAL',              'Rural'),
  ('LP_GREENFIELD',      'LP-Greenfield'),
  ('MOBILE',             'Mobile'),
  ('RU_GREENFIELD',      'RU-Greenfield'),
  ('ARCEPRU_GREENFIELD', 'ARCEPRU-Greenfield');

-- La colonne des sites passe de l'enum au code texte (valeurs conservées).
ALTER TABLE "sites" ALTER COLUMN "type_pylone" TYPE VARCHAR(40) USING "type_pylone"::text;
DROP TYPE "TypePylone";
