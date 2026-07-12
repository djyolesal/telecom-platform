-- Lien optionnel maintenance ↔ tâche préventive contractuelle
ALTER TABLE "maintenances" ADD COLUMN "tache_preventive_key" VARCHAR(40);
CREATE INDEX "maintenances_tache_preventive_key_idx" ON "maintenances"("tache_preventive_key");
