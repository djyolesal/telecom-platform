-- Cuve calculable : dimensions INTERNES structurées (cm) + table de barémage
-- par site. Le champ texte libre cuve_dimensions reste en lecture (héritage) ;
-- la conversion hauteur → litres s'appuie sur ces colonnes ou sur le barème.

ALTER TABLE "sites"
  ADD COLUMN "cuve_longueur_cm" DECIMAL(6,1),
  ADD COLUMN "cuve_largeur_cm"  DECIMAL(6,1),
  ADD COLUMN "cuve_hauteur_cm"  DECIMAL(6,1),
  ADD COLUMN "cuve_diametre_cm" DECIMAL(6,1);

CREATE TABLE "baremage_cuve" (
  "id" TEXT NOT NULL,
  "site_id" TEXT NOT NULL,
  "hauteur_cm" DECIMAL(6,1) NOT NULL,
  "litres" DECIMAL(8,1) NOT NULL,
  CONSTRAINT "baremage_cuve_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "baremage_cuve_site_id_fkey" FOREIGN KEY ("site_id")
    REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "baremage_cuve_site_id_hauteur_cm_key" ON "baremage_cuve"("site_id", "hauteur_cm");
