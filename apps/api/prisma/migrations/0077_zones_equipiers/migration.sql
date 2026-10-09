-- Équipiers des zones de maintenance : les FME vont souvent par deux, le
-- fichier de l'exploitant ne cite que le responsable d'équipe. Un équipier est
-- un contact SMS ; il reçoit les alertes de la zone et est proposé au NOC comme
-- technicien à contacter, comme le responsable.

CREATE TABLE "zones_maintenance_membres" (
  "zone_id" TEXT NOT NULL,
  "contact_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "zones_maintenance_membres_pkey" PRIMARY KEY ("zone_id", "contact_id"),
  CONSTRAINT "zones_maintenance_membres_zone_id_fkey" FOREIGN KEY ("zone_id")
    REFERENCES "zones_maintenance"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "zones_maintenance_membres_contact_id_fkey" FOREIGN KEY ("contact_id")
    REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "zones_maintenance_membres_contact_id_idx" ON "zones_maintenance_membres"("contact_id");
