-- Contacts à notifier par SMS quand un technicien démarre/clôture une action
-- (liste importée d'Excel, gérée en CRUD par l'admin), + journal des SMS émis.
CREATE TABLE "contacts" (
  "id"                 TEXT NOT NULL,
  "nom"                VARCHAR(80) NOT NULL,
  "prenom"             VARCHAR(80) NOT NULL,
  "telephone"          VARCHAR(20) NOT NULL,
  "email"              VARCHAR(100),
  "societe"            VARCHAR(80) NOT NULL,
  "prestataire_id"     TEXT,
  "actif"              BOOLEAN NOT NULL DEFAULT true,
  "notif_demarrage"    BOOLEAN NOT NULL DEFAULT true,
  "notif_cloture"      BOOLEAN NOT NULL DEFAULT true,
  "notif_maintenances" BOOLEAN NOT NULL DEFAULT true,
  "notif_incidents"    BOOLEAN NOT NULL DEFAULT true,
  "toutes_societes"    BOOLEAN NOT NULL DEFAULT false,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contacts_telephone_key" ON "contacts"("telephone");
CREATE INDEX "contacts_prestataire_id_idx" ON "contacts"("prestataire_id");

ALTER TABLE "contacts" ADD CONSTRAINT "contacts_prestataire_id_fkey"
  FOREIGN KEY ("prestataire_id") REFERENCES "prestataires"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "sms_logs" (
  "id"         TEXT NOT NULL,
  "telephone"  VARCHAR(20) NOT NULL,
  "contact_id" TEXT,
  "message"    VARCHAR(320) NOT NULL,
  "evenement"  VARCHAR(60) NOT NULL,
  "statut"     VARCHAR(12) NOT NULL,
  "erreur"     VARCHAR(200),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sms_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sms_logs_created_at_idx" ON "sms_logs"("created_at");
