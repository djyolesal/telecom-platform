-- Durée minimale de travail AVANT CLÔTURE, propre à une tâche préventive.
-- Pas de ligne = la durée globale (paramètre maintenance.minDureeClotureMin)
-- s'applique. Table séparée des surcharges libellé/fréquence, comme les prix :
-- « Restaurer le défaut » supprime la surcharge, il ne doit pas emporter la
-- durée. Additive, aucune donnée existante touchée.

CREATE TABLE "taches_preventives_durees" (
  "tache_key" VARCHAR(40) NOT NULL,
  "duree_min_cloture_min" INTEGER NOT NULL,
  "updated_by" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "taches_preventives_durees_pkey" PRIMARY KEY ("tache_key"),
  CONSTRAINT "taches_preventives_durees_bornes_check" CHECK ("duree_min_cloture_min" BETWEEN 0 AND 720)
);
