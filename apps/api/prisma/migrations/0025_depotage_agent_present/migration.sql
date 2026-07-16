-- Dépotage : déclaration « agent de gardiennage présent » (alimente le rapport
-- gardiennage, en plus de la signature tripartite existante).
ALTER TABLE "depotages" ADD COLUMN "agent_present" BOOLEAN;
