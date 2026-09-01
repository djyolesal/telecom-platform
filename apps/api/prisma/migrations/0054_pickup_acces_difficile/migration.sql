-- Sites à accès difficile : le camion citerne ne peut pas atteindre le site,
-- le carburant termine sa route par un véhicule de transfert (« pickup »).
--
-- Deux niveaux, volontairement :
--   · sites.acces_pickup       = caractéristique DURABLE du site (le défaut) ;
--   · lignes_livraison.pickup  = surcharge PONCTUELLE d'un plan (piste coupée
--     en saison des pluies, ou au contraire accès rétabli). NULL = hérite du
--     site, ce qui évite de re-cocher les mêmes sites à chaque plan.
ALTER TABLE sites ADD COLUMN IF NOT EXISTS acces_pickup BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE lignes_livraison ADD COLUMN IF NOT EXISTS pickup BOOLEAN;

COMMENT ON COLUMN sites.acces_pickup IS 'Site à accès difficile : livraison par véhicule de transfert (pickup)';
COMMENT ON COLUMN lignes_livraison.pickup IS 'Surcharge ponctuelle du pickup pour ce plan ; NULL = hérite de sites.acces_pickup';
