-- Activer TimescaleDB
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Les hypertables sont créées après migration Prisma via ce script
-- (exécuté manuellement après la première migration)

-- À exécuter UNE FOIS après "make migrate" :
--
-- SELECT create_hypertable('releves_energie', 'date_releve',
--   chunk_time_interval => INTERVAL '1 month',
--   if_not_exists => TRUE
-- );
--
-- SELECT create_hypertable('depotages', 'date_depotage',
--   chunk_time_interval => INTERVAL '1 month',
--   if_not_exists => TRUE
-- );
--
-- -- Vue matérialisée consommation mensuelle
-- CREATE MATERIALIZED VIEW IF NOT EXISTS conso_mensuelle_mv AS
-- SELECT
--   date_trunc('month', date_releve) AS mois,
--   site_id, source,
--   SUM(consommation_kwh)     AS total_kwh,
--   SUM(volume_gasoil_litres) AS total_litres,
--   SUM(cout_estime)          AS total_cout_fcfa,
--   COUNT(*)                  AS nb_releves
-- FROM releves_energie
-- GROUP BY 1, 2, 3;

-- Index supplémentaires pour performance
-- (après migration Prisma)
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_releves_site_date
--   ON releves_energie(site_id, date_releve DESC);
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_incidents_region
--   ON incidents(date_ouverture DESC)
--   WHERE statut IN ('OUVERT','EN_COURS');
