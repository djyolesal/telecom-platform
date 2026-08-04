-- Référentiels CHAUFFEUR et VÉHICULE.
-- Jusqu'ici : aucune entité, `immatriculation` en texte libre non indexé avec
-- deux graphies natives, `nomChauffeur` utilisé à deux endroits dans tout le
-- code (une écriture, une lecture pour l'étiquette du PDF). Aucune question du
-- type « ce camion a-t-il des manquants récurrents ? » n'avait de réponse.

CREATE TABLE IF NOT EXISTS "vehicules" (
  "id" TEXT NOT NULL,
  "immatriculation" VARCHAR(30) NOT NULL,   -- normalisée (clé d'agrégation)
  "libelle" VARCHAR(30) NOT NULL,           -- graphie d'origine (affichage)
  "prestataire_id" TEXT,
  "capacite_citerne_litres" DECIMAL(10,2),
  "marque" VARCHAR(60),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vehicules_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "vehicules_immatriculation_key" ON "vehicules"("immatriculation");
CREATE INDEX IF NOT EXISTS "vehicules_prestataire_id_idx" ON "vehicules"("prestataire_id");

CREATE TABLE IF NOT EXISTS "chauffeurs" (
  "id" TEXT NOT NULL,
  "nom" VARCHAR(100) NOT NULL,
  "nom_normalise" VARCHAR(100) NOT NULL,
  "prestataire_id" TEXT,
  "telephone" VARCHAR(30),
  "numero_permis" VARCHAR(40),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chauffeurs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "chauffeurs_prestataire_id_nom_normalise_key" ON "chauffeurs"("prestataire_id", "nom_normalise");
CREATE INDEX IF NOT EXISTS "chauffeurs_nom_normalise_idx" ON "chauffeurs"("nom_normalise");

DO $$ BEGIN
  ALTER TABLE "vehicules" ADD CONSTRAINT "vehicules_prestataire_id_fkey"
    FOREIGN KEY ("prestataire_id") REFERENCES "prestataires"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "chauffeurs" ADD CONSTRAINT "chauffeurs_prestataire_id_fkey"
    FOREIGN KEY ("prestataire_id") REFERENCES "prestataires"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "bons_livraison"
  ADD COLUMN IF NOT EXISTS "vehicule_id" TEXT,
  ADD COLUMN IF NOT EXISTS "chauffeur_id" TEXT;
ALTER TABLE "depotages"
  ADD COLUMN IF NOT EXISTS "chauffeur_id" TEXT;

DO $$ BEGIN
  ALTER TABLE "bons_livraison" ADD CONSTRAINT "bons_livraison_vehicule_id_fkey"
    FOREIGN KEY ("vehicule_id") REFERENCES "vehicules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "bons_livraison" ADD CONSTRAINT "bons_livraison_chauffeur_id_fkey"
    FOREIGN KEY ("chauffeur_id") REFERENCES "chauffeurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "depotages" ADD CONSTRAINT "depotages_chauffeur_id_fkey"
    FOREIGN KEY ("chauffeur_id") REFERENCES "chauffeurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "bons_livraison_vehicule_id_idx" ON "bons_livraison"("vehicule_id");
CREATE INDEX IF NOT EXISTS "bons_livraison_chauffeur_id_idx" ON "bons_livraison"("chauffeur_id");
CREATE INDEX IF NOT EXISTS "depotages_chauffeur_id_idx" ON "depotages"("chauffeur_id");

-- ── Backfill : le référentiel se peuple à partir de l'existant ──────────────
-- Normalisation de plaque : majuscules, tout caractère non alphanumérique
-- retiré. « TG 1234 AB », « tg-1234-ab » et « TG1234AB » deviennent une seule
-- clé. La sentinelle « À AFFECTER » des brouillons est exclue : ce n'est pas un
-- camion, et l'agréger inventerait un véhicule fantôme portant tous les
-- brouillons du parc.
INSERT INTO "vehicules" ("id", "immatriculation", "libelle", "prestataire_id", "created_at", "updated_at")
SELECT
  gen_random_uuid()::text,
  norm.imm,
  MIN(norm.libelle),
  (ARRAY_AGG(norm.transporteur_id ORDER BY norm.transporteur_id) FILTER (WHERE norm.transporteur_id IS NOT NULL))[1],
  NOW(), NOW()
FROM (
  SELECT
    UPPER(REGEXP_REPLACE(bl."immatriculation", '[^A-Za-z0-9]', '', 'g')) AS imm,
    bl."immatriculation" AS libelle,
    bl."transporteur_id"
  FROM "bons_livraison" bl
  WHERE bl."immatriculation" IS NOT NULL
    AND UPPER(REGEXP_REPLACE(bl."immatriculation", '[^A-Za-z0-9]', '', 'g')) <> ''
    AND UPPER(REGEXP_REPLACE(bl."immatriculation", '[^A-Za-z0-9]', '', 'g')) NOT IN ('AAFFECTER', 'ÀAFFECTER')
) norm
GROUP BY norm.imm
ON CONFLICT ("immatriculation") DO NOTHING;

UPDATE "bons_livraison" bl
SET "vehicule_id" = v."id"
FROM "vehicules" v
WHERE bl."vehicule_id" IS NULL
  AND v."immatriculation" = UPPER(REGEXP_REPLACE(bl."immatriculation", '[^A-Za-z0-9]', '', 'g'));

-- Chauffeurs connus par leur seule trace existante : le nom signé au dépotage.
-- Rattachés au transporteur du BL quand le dépotage est relié à un plan.
INSERT INTO "chauffeurs" ("id", "nom", "nom_normalise", "prestataire_id", "created_at", "updated_at")
SELECT gen_random_uuid()::text, MIN(src.nom), src.nom_norm, src.prestataire_id, NOW(), NOW()
FROM (
  SELECT
    TRIM(d."nom_chauffeur") AS nom,
    UPPER(REGEXP_REPLACE(TRIM(d."nom_chauffeur"), '\s+', ' ', 'g')) AS nom_norm,
    bl."transporteur_id" AS prestataire_id
  FROM "depotages" d
  LEFT JOIN "lignes_livraison" ll ON ll."id" = d."ligne_livraison_id"
  LEFT JOIN "bons_livraison" bl ON bl."id" = ll."bon_livraison_id"
  WHERE d."nom_chauffeur" IS NOT NULL AND TRIM(d."nom_chauffeur") <> ''
) src
GROUP BY src.nom_norm, src.prestataire_id
ON CONFLICT ("prestataire_id", "nom_normalise") DO NOTHING;

UPDATE "depotages" d
SET "chauffeur_id" = c."id"
FROM "chauffeurs" c
WHERE d."chauffeur_id" IS NULL
  AND d."nom_chauffeur" IS NOT NULL
  AND c."nom_normalise" = UPPER(REGEXP_REPLACE(TRIM(d."nom_chauffeur"), '\s+', ' ', 'g'));
