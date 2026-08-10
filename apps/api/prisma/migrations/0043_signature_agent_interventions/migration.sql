-- Signature de l'agent de gardiennage sur TOUTES les interventions terrain.
-- La règle « agent présent ⇒ il signe » n'existait qu'au dépotage : aux
-- clôtures de maintenance et d'incident, la présence n'était que déclarée.
-- La signature transforme la déclaration en preuve opposable — et le rapport
-- gardiennage cesse de reposer sur la parole seule du technicien.
ALTER TABLE "maintenances"
  ADD COLUMN IF NOT EXISTS "nom_agent_securite" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "signature_agent_securite_path" TEXT;

ALTER TABLE "incidents"
  ADD COLUMN IF NOT EXISTS "nom_agent_securite" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "signature_agent_securite_path" TEXT;
