-- SMS à l'enregistrement d'un dépotage : préférence OPT-IN (défaut false) —
-- la passerelle est réelle, un SMS par dépotage sur tout le parc chiffre vite.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS notif_livraisons BOOLEAN NOT NULL DEFAULT false;
