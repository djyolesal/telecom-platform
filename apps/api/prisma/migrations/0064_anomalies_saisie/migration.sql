-- ANOMALIES DE SAISIE : le résultat des contrôles de vraisemblance, enregistré
-- comme DONNÉE et non plus comme une phrase dans les observations.
--
-- Jusqu'ici, une valeur douteuse confirmée par le technicien laissait deux
-- traces : du texte libre dans `observations` et un bloc JSON dans le journal
-- d'audit. Impossible d'en tirer une liste, un compte ou une tendance - donc
-- impossible d'en faire quoi que ce soit.
--
-- `statut` sert au traitement par la supervision (écran dédié à venir) :
-- A_VERIFIER à la création, puis JUSTIFIEE (compteur remplacé, cuve agrandie…)
-- ou A_CORRIGER.
CREATE TABLE IF NOT EXISTS "anomalies_saisie" (
  "id"              TEXT PRIMARY KEY,
  "code"            VARCHAR(40) NOT NULL,
  "champ"           VARCHAR(40) NOT NULL,
  "message"         TEXT        NOT NULL,
  "valeur_saisie"   DECIMAL(12,2),
  "valeur_attendue" VARCHAR(120),
  "source"          VARCHAR(20) NOT NULL,        -- MAINTENANCE | DEPOTAGE | RELEVE
  "site_id"         TEXT        NOT NULL,
  "maintenance_id"  TEXT,
  "depotage_id"     TEXT,
  "releve_id"       TEXT,
  "technicien_id"   TEXT,
  -- Le technicien a vu l'avertissement et a confirmé sa saisie. FAUX quand le
  -- contrôle a lieu APRÈS coup (relevé saisi hors intervention) : personne
  -- n'a rien confirmé, et l'anomalie n'en est pas moins réelle.
  "confirmee"       BOOLEAN     NOT NULL DEFAULT false,
  "statut"          VARCHAR(12) NOT NULL DEFAULT 'A_VERIFIER',
  "traitee_par"     TEXT,
  "traitee_le"      TIMESTAMP(3),
  "motif_traitement" TEXT,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "anomalies_saisie_site_id_fkey"
    FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "anomalies_saisie_created_at_idx" ON "anomalies_saisie" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "anomalies_saisie_site_idx" ON "anomalies_saisie" ("site_id");
CREATE INDEX IF NOT EXISTS "anomalies_saisie_code_idx" ON "anomalies_saisie" ("code");
CREATE INDEX IF NOT EXISTS "anomalies_saisie_statut_idx" ON "anomalies_saisie" ("statut");
