-- Prise en charge NOC d'une coupure détectée automatiquement (OSS) :
-- l'opérateur adopte l'événement — rattachement amont/aval fait au passage.
-- Additive et rejouable.
ALTER TABLE coupures_reseau ADD COLUMN IF NOT EXISTS prise_en_charge_par VARCHAR(100);
ALTER TABLE coupures_reseau ADD COLUMN IF NOT EXISTS prise_en_charge_le TIMESTAMP(3);
