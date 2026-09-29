-- PÉRIMÈTRE CONTRACTUEL : ce qui est dû, et ce qui ne l'est pas.
--
-- Jusqu'ici, une tâche était due dès que le site en avait l'équipement :
-- l'éligibilité répondait à « ce site A-T-IL un GE ? ». Or certains sites -
-- les centres techniques - ont bien un GE dont l'entretien N'EST PAS au
-- contrat passif. Question de périmètre, pas de technique.
--
-- Deux objets distincts, et l'ordre compte :
--   * `sites.type_site` DÉCRIT le site (centre technique, BTS…). Il sert à
--     reconnaître la population et à poser les exclusions en masse. Le moteur
--     de conformité ne le consulte JAMAIS : sinon deux sources répondraient à
--     la même question et finiraient par diverger.
--   * `exclusions_contractuelles` DÉCIDE. Une ligne par (site, tâche), datée,
--     motivée, attribuée.
--
-- DATÉE, et c'est essentiel : la fiche de validation compte « sites concernés »
-- par tâche, et elle est SIGNÉE. Une exclusion sans date recalculerait les
-- mois déjà signés et leurs chiffres ne concorderaient plus. `debut_le` laisse
-- le passé intact.

-- Type de site : code d'un référentiel éditable (types_site dans les réglages).
-- NULL = site standard : les 558 sites existants ne changent de rien.
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "type_site" VARCHAR(40);
CREATE INDEX IF NOT EXISTS "sites_type_site_idx" ON "sites" ("type_site");

CREATE TABLE IF NOT EXISTS "exclusions_contractuelles" (
  "id"          TEXT PRIMARY KEY,
  "site_id"     TEXT NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
  -- Clé du catalogue contractuel (ge_secours, curage_cuve…). Pas de contrainte
  -- d'énumération en base : le catalogue vit dans le code, et une clé retirée
  -- ne doit pas empêcher de relire l'historique.
  "tache_key"   VARCHAR(40) NOT NULL,
  "motif"       VARCHAR(300) NOT NULL,
  -- Période couverte. `fin_le` NULL = exclusion toujours en vigueur.
  "debut_le"    DATE NOT NULL,
  "fin_le"      DATE,
  "cree_par"    TEXT REFERENCES "users"("id"),
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "exclusions_contractuelles_site_idx" ON "exclusions_contractuelles" ("site_id");
CREATE INDEX IF NOT EXISTS "exclusions_contractuelles_tache_idx" ON "exclusions_contractuelles" ("tache_key");

-- Un seul enregistrement OUVERT par couple : deux exclusions sans fin sur la
-- même tâche du même site ne voudraient rien dire de plus, et compliqueraient
-- la levée. Les exclusions CLOSES, elles, s'empilent - c'est l'historique.
CREATE UNIQUE INDEX IF NOT EXISTS "exclusions_contractuelles_ouverte_unique"
  ON "exclusions_contractuelles" ("site_id", "tache_key") WHERE "fin_le" IS NULL;

-- Référentiel éditable des natures de site, calqué sur types_pylone.
CREATE TABLE IF NOT EXISTS "types_site" (
  "code"       VARCHAR(40) PRIMARY KEY,
  "libelle"    VARCHAR(80) NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Deux valeurs pour démarrer ; le reste se déclare depuis l'administration.
INSERT INTO "types_site" ("code", "libelle") VALUES
  ('BTS', 'Site BTS'),
  ('CENTRE_TECHNIQUE', 'Centre technique')
ON CONFLICT ("code") DO NOTHING;
