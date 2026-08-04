-- Mouvements de carburant hors chaîne BC → BL → dépotage.
-- Trois cas d'exploitation n'avaient aucune écriture possible :
--  · transfert entre sites → il fallait inventer un faux dépotage, qui
--    déclenchait une fausse alerte de vol sur le site donneur ;
--  · reprise fournisseur (avoir) → volumes négatifs interdits partout ;
--  · purge / vidange de cuve → comptée comme une surconsommation.

DO $$ BEGIN
  CREATE TYPE "TypeMouvementCarburant" AS ENUM ('TRANSFERT_SORTIE', 'TRANSFERT_ENTREE', 'PURGE', 'AVOIR_FOURNISSEUR');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "mouvements_carburant" (
  "id" TEXT NOT NULL,
  "reference" VARCHAR(20),
  "type" "TypeMouvementCarburant" NOT NULL,
  "groupe_id" TEXT,              -- relie les deux jambes d'un transfert
  "site_id" TEXT,
  "contrepartie_id" TEXT,
  "bon_commande_id" TEXT,
  "volume_litres" DECIMAL(10,2) NOT NULL,
  "date_mouvement" TIMESTAMP(3) NOT NULL,
  "motif" TEXT NOT NULL,
  "document_path" TEXT,
  "auteur_id" TEXT,
  "latitude" DECIMAL(10,8),
  "longitude" DECIMAL(11,8),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mouvements_carburant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "mouvements_carburant_reference_key" ON "mouvements_carburant"("reference");
CREATE INDEX IF NOT EXISTS "mouvements_carburant_site_id_date_mouvement_idx" ON "mouvements_carburant"("site_id", "date_mouvement");
CREATE INDEX IF NOT EXISTS "mouvements_carburant_groupe_id_idx" ON "mouvements_carburant"("groupe_id");
CREATE INDEX IF NOT EXISTS "mouvements_carburant_bon_commande_id_idx" ON "mouvements_carburant"("bon_commande_id");
CREATE INDEX IF NOT EXISTS "mouvements_carburant_type_idx" ON "mouvements_carburant"("type");

-- Le SENS vient du type, jamais du signe : un volume négatif fausserait
-- silencieusement tous les cumuls.
ALTER TABLE "mouvements_carburant" DROP CONSTRAINT IF EXISTS "mvt_volume_positif";
ALTER TABLE "mouvements_carburant" ADD CONSTRAINT "mvt_volume_positif" CHECK ("volume_litres" > 0);

-- Un mouvement de site porte un site ; un avoir fournisseur porte une commande.
ALTER TABLE "mouvements_carburant" DROP CONSTRAINT IF EXISTS "mvt_rattachement";
ALTER TABLE "mouvements_carburant" ADD CONSTRAINT "mvt_rattachement" CHECK (
  ("type" = 'AVOIR_FOURNISSEUR' AND "bon_commande_id" IS NOT NULL)
  OR ("type" <> 'AVOIR_FOURNISSEUR' AND "site_id" IS NOT NULL)
);

-- Un site ne se transfère pas à lui-même.
ALTER TABLE "mouvements_carburant" DROP CONSTRAINT IF EXISTS "mvt_contrepartie_distincte";
ALTER TABLE "mouvements_carburant" ADD CONSTRAINT "mvt_contrepartie_distincte" CHECK (
  "contrepartie_id" IS NULL OR "contrepartie_id" <> "site_id"
);

DO $$ BEGIN
  ALTER TABLE "mouvements_carburant" ADD CONSTRAINT "mouvements_carburant_site_id_fkey"
    FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "mouvements_carburant" ADD CONSTRAINT "mouvements_carburant_contrepartie_id_fkey"
    FOREIGN KEY ("contrepartie_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "mouvements_carburant" ADD CONSTRAINT "mouvements_carburant_bon_commande_id_fkey"
    FOREIGN KEY ("bon_commande_id") REFERENCES "bons_commande"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "mouvements_carburant" ADD CONSTRAINT "mouvements_carburant_auteur_id_fkey"
    FOREIGN KEY ("auteur_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
