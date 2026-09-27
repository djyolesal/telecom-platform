-- ARCHIVE DES RAPPORTS MENSUELS D'ACTIVITÉ.
--
-- Les envoyer par e-mail ne marche pas : dix mégaoctets de pièce jointe, des
-- relais qui refusent sans prévenir, des boîtes pleines. Le document est donc
-- PUBLIÉ sur la plateforme, mois après mois, et chacun vient le chercher dans
-- son périmètre.
--
-- Une ligne par (mois, lot, prestataire, contrat) : c'est le découpage
-- contractuel, celui qui se signe et se facture.
CREATE TABLE IF NOT EXISTS "rapports_mensuels" (
  "id"              TEXT PRIMARY KEY,
  "mois"            VARCHAR(7)  NOT NULL,          -- AAAA-MM
  "lot_id"          TEXT        NOT NULL,
  "prestataire_id"  TEXT        NOT NULL,
  "contrat"         VARCHAR(10) NOT NULL DEFAULT 'PASSIF',
  "reference"       VARCHAR(30) NOT NULL,
  "minio_key"       TEXT        NOT NULL,
  "fiche_minio_key" TEXT,
  "taille_octets"   INTEGER     NOT NULL DEFAULT 0,
  "nb_sites"        INTEGER     NOT NULL DEFAULT 0,
  "nb_interventions" INTEGER    NOT NULL DEFAULT 0,
  "genere_le"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "genere_par"      TEXT,                          -- NULL = archivage automatique
  CONSTRAINT "rapports_mensuels_lot_id_fkey"
    FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "rapports_mensuels_prestataire_id_fkey"
    FOREIGN KEY ("prestataire_id") REFERENCES "prestataires"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Un seul rapport par couple et par mois : une régénération REMPLACE, elle
-- n'empile pas des versions que personne ne saurait départager.
CREATE UNIQUE INDEX IF NOT EXISTS "rapports_mensuels_unique"
  ON "rapports_mensuels" ("mois", "lot_id", "prestataire_id", "contrat");
-- La liste se lit par mois décroissant : le dernier en haut.
CREATE INDEX IF NOT EXISTS "rapports_mensuels_mois_idx" ON "rapports_mensuels" ("mois" DESC);
