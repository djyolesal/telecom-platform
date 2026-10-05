-- RELEVÉS PRIS HORS APPLICATION, enregistrés après coup par un administrateur.
--
-- Un relevé de terrain n'entre pas toujours par l'application : fiche papier,
-- message d'un technicien sans téléphone adapté, rattrapage d'une période
-- d'avant le déploiement. L'administrateur peut désormais les saisir depuis le
-- portail ; ces deux colonnes disent d'où vient la donnée et qui l'a écrite.
--
--   origine       NULL = saisie normale (mobile ou portail, au fil de l'eau).
--                 'HORS_APP' = relevé pris hors application, saisi après coup.
--                 NULL et non 'APP' : les relevés existants ne sont ni tous du
--                 mobile ni tous du portail, les étiqueter 'APP' serait inventer.
--   saisi_par_id  l'administrateur qui a SAISI. `technicien_id`, lui, reste la
--                 personne qui a PRIS le relevé : ce ne sont pas les mêmes gens.
ALTER TABLE "releves_energie" ADD COLUMN "origine" VARCHAR(12);
ALTER TABLE "releves_energie" ADD COLUMN "saisi_par_id" TEXT;

ALTER TABLE "releves_energie"
  ADD CONSTRAINT "releves_energie_origine_valide" CHECK ("origine" IS NULL OR "origine" IN ('HORS_APP'));

ALTER TABLE "releves_energie"
  ADD CONSTRAINT "releves_energie_saisi_par_id_fkey"
  FOREIGN KEY ("saisi_par_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
