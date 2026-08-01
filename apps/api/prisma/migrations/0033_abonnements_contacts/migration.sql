-- Abonnements de notification affinés par contact : coupures partielles
-- (équipes actives) et situation périodique (récap des dépassements de seuil).
ALTER TABLE "contacts" ADD COLUMN "notif_coupures" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "contacts" ADD COLUMN "notif_situations" BOOLEAN NOT NULL DEFAULT true;
