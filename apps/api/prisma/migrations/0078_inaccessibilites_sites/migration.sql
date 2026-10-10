-- Périodes d'inaccessibilité des sites (route coupée, crue, saison des pluies).
-- Les tâches restent DUES ; une tâche due et non réalisée sur un mois couvert
-- est JUSTIFIÉE (ni retard ni pénalité, montrée à part dans les rapports).
-- fin_le NULL : accès pas encore rétabli.

CREATE TABLE "inaccessibilites_sites" (
  "id" TEXT NOT NULL,
  "site_id" TEXT NOT NULL,
  "debut_le" DATE NOT NULL,
  "fin_le" DATE,
  "motif" VARCHAR(300) NOT NULL,
  "cree_par" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "inaccessibilites_sites_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inaccessibilites_sites_site_id_fkey" FOREIGN KEY ("site_id")
    REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "inaccessibilites_sites_cree_par_fkey" FOREIGN KEY ("cree_par")
    REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "inaccessibilites_sites_dates_check" CHECK ("fin_le" IS NULL OR "fin_le" >= "debut_le")
);
CREATE INDEX "inaccessibilites_sites_site_id_idx" ON "inaccessibilites_sites"("site_id");
