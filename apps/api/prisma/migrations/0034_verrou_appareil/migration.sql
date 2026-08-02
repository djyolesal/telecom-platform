-- Verrou d'appareil des comptes terrain : liaison au premier mobile connecté.
ALTER TABLE "users" ADD COLUMN "appareil_id" VARCHAR(100);
ALTER TABLE "users" ADD COLUMN "appareil_label" VARCHAR(80);
ALTER TABLE "users" ADD COLUMN "appareil_lie_le" TIMESTAMP(3);
