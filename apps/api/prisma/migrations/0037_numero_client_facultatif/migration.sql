-- Le bon de commande réel (modèle Moov Africa) ne porte aucun « numéro
-- client » : il a un centre de coût, un compte fournisseur et une DA. Le champ
-- devient facultatif — les BC existants qui en ont un le conservent.
ALTER TABLE "bons_commande" ALTER COLUMN "numero_client" DROP NOT NULL;
-- Hérité du BC à la création du BL : suit la même règle.
ALTER TABLE "bons_livraison" ALTER COLUMN "numero_client" DROP NOT NULL;
