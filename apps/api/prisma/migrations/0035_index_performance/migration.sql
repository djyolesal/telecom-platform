-- Index de performance identifiés par l'audit d'août 2026.
-- CONCURRENTLY impossible dans une migration transactionnelle Prisma : ces tables
-- restent petites (≤ quelques 100k lignes), la création est de l'ordre de la seconde.

-- Relevés : toutes les requêtes chaudes filtrent (site, source) et trient par date desc
-- (contexte de saisie mobile, vraisemblance, dernier stock connu).
CREATE INDEX IF NOT EXISTS "releves_energie_site_source_date_idx"
  ON "releves_energie" ("site_id", "source", "date_releve" DESC);

-- Coupures : aiguillage des orphelines et imputation SLA passive.
CREATE INDEX IF NOT EXISTS "coupures_reseau_origine_fin_incident_idx"
  ON "coupures_reseau" ("origine", "date_fin", "incident_id");
CREATE INDEX IF NOT EXISTS "coupures_reseau_categorie_origine_idx"
  ON "coupures_reseau" ("cause_categorie", "origine");

-- Maintenances : jointure incident, SLA préventif, rapports de conformité.
CREATE INDEX IF NOT EXISTS "maintenances_incident_id_idx" ON "maintenances" ("incident_id");
CREATE INDEX IF NOT EXISTS "maintenances_type_date_planifiee_idx" ON "maintenances" ("type", "date_planifiee");
CREATE INDEX IF NOT EXISTS "maintenances_statut_date_fin_idx" ON "maintenances" ("statut", "date_fin");

-- Incidents : escalade horaire, situation périodique, délais SLA.
CREATE INDEX IF NOT EXISTS "incidents_statut_ouverture_idx" ON "incidents" ("statut", "date_ouverture");
CREATE INDEX IF NOT EXISTS "incidents_date_resolution_idx" ON "incidents" ("date_resolution");
CREATE INDEX IF NOT EXISTS "incidents_technicien_id_idx" ON "incidents" ("technicien_id");

-- Clés étrangères non indexées.
CREATE INDEX IF NOT EXISTS "depotages_technicien_id_idx" ON "depotages" ("technicien_id");

-- Plafond SMS : compte les envois du jour avant CHAQUE lot.
CREATE INDEX IF NOT EXISTS "sms_logs_statut_created_idx" ON "sms_logs" ("statut", "created_at");
