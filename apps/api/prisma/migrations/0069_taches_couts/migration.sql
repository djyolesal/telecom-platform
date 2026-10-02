-- COÛT UNITAIRE des tâches préventives contractuelles.
--
-- Préparation de la facturation mensuelle : le rapport mensuel publié
-- accueillera la facture du mois, qui se calcule à partir de ce qui a été
-- RÉALISÉ (fiche de validation) multiplié par le prix de la tâche.
--
-- Sens du montant : prix en FCFA d'UNE exécution de la tâche sur UN site.
--
-- TABLE À PART, et non une colonne de `taches_preventives_overrides` : cette
-- dernière ne porte que les surcharges de libellé et de fréquence, et le bouton
-- « Restaurer le défaut » en supprime la ligne. Un prix rangé là disparaîtrait
-- en silence à la première restauration d'un libellé.
--
-- Pas de ligne = tâche NON TARIFÉE. C'est distinct de 0 (prestation incluse,
-- gratuite) : une facture doit pouvoir dire « prix manquant » plutôt que
-- d'afficher 0 par défaut.
CREATE TABLE "taches_preventives_couts" (
    "tache_key"     VARCHAR(40)    NOT NULL,
    "cout_unitaire" DECIMAL(12,2)  NOT NULL,
    "updated_by"    TEXT,
    "updated_at"    TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "taches_preventives_couts_pkey" PRIMARY KEY ("tache_key"),
    CONSTRAINT "taches_preventives_couts_positif" CHECK ("cout_unitaire" >= 0)
);
