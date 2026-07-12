-- Enums infrastructure site
CREATE TYPE "TypePylone" AS ENUM ('GREENFIELD', 'ROOFTOP', 'TGC_GREENFIELD', 'TROTTOIR', 'RURAL', 'LP_GREENFIELD');
CREATE TYPE "FormeCuve" AS ENUM ('RECTANGULAIRE', 'CYLINDRE_COUCHE');

-- Nouvelles colonnes sur sites
ALTER TABLE "sites"
  ADD COLUMN "has_climatiseur" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "has_extincteurs" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "type_pylone" "TypePylone",
  ADD COLUMN "cuve_volume_litres" DECIMAL(8,2),
  ADD COLUMN "forme_cuve" "FormeCuve",
  ADD COLUMN "cuve_dimensions" VARCHAR(100);
