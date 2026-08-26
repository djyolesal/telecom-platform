-- Checklist contractuelle TYPÉE des clôtures solaires : une ligne par
-- opération du PV (résultat Conforme/Non conforme/N-A + mesure + commentaire).
-- Remplace le tableau Word où l'état, la remarque et les mesures se mélangeaient.
CREATE TABLE "maintenance_checklist" (
  "id" TEXT NOT NULL,
  "maintenance_id" TEXT NOT NULL,
  "cle" VARCHAR(60) NOT NULL,
  "resultat" VARCHAR(15) NOT NULL,
  "valeur" VARCHAR(200),
  "commentaire" VARCHAR(300),
  CONSTRAINT "maintenance_checklist_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "maintenance_checklist_maintenance_id_fkey" FOREIGN KEY ("maintenance_id")
    REFERENCES "maintenances"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "maintenance_checklist_maintenance_id_cle_key" ON "maintenance_checklist"("maintenance_id", "cle");
