-- Rôle NOC (centre de supervision réseau) : coupures/topologie en écriture,
-- pas d'O&M ni d'administration. (PG16 : ADD VALUE autorisé en transaction
-- tant que la nouvelle valeur n'est pas utilisée dans la même transaction.)
ALTER TYPE "RoleUser" ADD VALUE 'NOC';

-- Lien coupure → incident terrain créé automatiquement (groupé par site),
-- et classement de l'indisponibilité (ACTIF radio/transmission, PASSIF énergie).
ALTER TABLE "coupures_reseau" ADD COLUMN "incident_id" TEXT;
ALTER TABLE "coupures_reseau" ADD COLUMN "cause_categorie" VARCHAR(10);
ALTER TABLE "coupures_reseau" ADD CONSTRAINT "coupures_reseau_incident_id_fkey"
  FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "coupures_reseau_incident_id_idx" ON "coupures_reseau"("incident_id");
