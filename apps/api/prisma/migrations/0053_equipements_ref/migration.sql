-- Référentiel des ÉQUIPEMENTS de dépannage (éditable en admin) : chaque entrée
-- porte sa catégorie contractuelle parente — c'est elle qui route l'intervention
-- (prestataire passif/actif/solaire, équipe, règles de clôture). Répartition
-- validée par l'exploitant le 27/08/2026.
CREATE TABLE "equipements_ref" (
  "code" VARCHAR(40) NOT NULL,
  "libelle" VARCHAR(80) NOT NULL,
  "categorie" "CategorieEquipement" NOT NULL,
  "actif" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "equipements_ref_pkey" PRIMARY KEY ("code")
);

INSERT INTO "equipements_ref" ("code", "libelle", "categorie") VALUES
  ('ATS',                 'ATS (inverseur de sources)',        'AUTRE'),
  ('TGBT',                'TGBT',                              'AUTRE'),
  ('GE',                  'Groupe électrogène',                'GE'),
  ('COMPTEUR_CEET',       'Compteur CEET',                     'AUTRE'),
  ('ATELIER_ENERGIE',     'Atelier d''énergie',                'AUTRE'),
  ('REDRESSEURS',         'Redresseurs',                       'RESEAU'),
  ('CLIMATISEUR',         'Climatiseur',                       'CLIMATISEUR'),
  ('BATTERIES',           'Batteries',                         'BATTERIE'),
  ('PANNEAUX_REGULATEUR', 'Panneaux / régulateur solaire',     'SOLAIRE'),
  ('PYLONE_BALISAGE',     'Pylône / balisage',                 'AUTRE'),
  ('ANTENNE_FH',          'Antenne / FH',                      'ANTENNE');

-- Code d'équipement structuré sur la maintenance (le libellé reste dans la
-- colonne texte `equipement` — compatibilité affichages/exports/mobile).
ALTER TABLE "maintenances" ADD COLUMN "equipement_code" VARCHAR(40);
