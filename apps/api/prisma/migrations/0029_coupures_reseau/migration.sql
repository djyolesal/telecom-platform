-- Module « Coupures réseau » : supervision NOC des indisponibilités radio
-- (par technologie 2G/3G/4G/5G ou site entier), saisies dans l'app ou
-- importées du rapport Excel de supervision.
CREATE TABLE "coupures_reseau" (
  "id" TEXT NOT NULL,
  "site_id" TEXT NOT NULL,
  "technologie" VARCHAR(12) NOT NULL,           -- 2G | 3G | 4G | 5G | SITE (site entier)
  "frequence" VARCHAR(30),
  "secteur" VARCHAR(20),
  "date_debut" TIMESTAMP(3) NOT NULL,
  "date_fin" TIMESTAMP(3),
  "downtime_minutes" INTEGER,                    -- calculé à la clôture
  "heure_contact" TIMESTAMP(3),
  "technicien_contacte" VARCHAR(100),
  "date_arrivee_site" TIMESTAMP(3),
  "intervenants" VARCHAR(200),
  "cause" VARCHAR(300),
  "actions" VARCHAR(300),
  "type_alarme" VARCHAR(10),                     -- référentiel NOC : AE, GE, EN, FO, TX, RA, MI, NA, MD…
  "noc_engineer" VARCHAR(100),
  "observations" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "coupures_reseau_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "coupures_reseau" ADD CONSTRAINT "coupures_reseau_site_id_fkey"
  FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Idempotence du ré-import mensuel du rapport NOC (fréquence normalisée '-').
CREATE UNIQUE INDEX "coupures_reseau_unicite" ON "coupures_reseau"("site_id", "technologie", (COALESCE("frequence",'-')), "date_debut");
CREATE INDEX "coupures_reseau_site_id_idx" ON "coupures_reseau"("site_id");
CREATE INDEX "coupures_reseau_date_debut_idx" ON "coupures_reseau"("date_debut");
CREATE INDEX "coupures_reseau_date_fin_idx" ON "coupures_reseau"("date_fin");
CREATE INDEX "coupures_reseau_type_alarme_idx" ON "coupures_reseau"("type_alarme");
