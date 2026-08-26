/**
 * Référentiel de la CHECKLIST contractuelle solaire : les opérations du PV
 * (contrat unique, commun à tous les prestataires solaires), groupées par
 * visite planifiable. Chaque item se clôt en CONFORME | NON_CONFORME | NA,
 * avec une mesure quand l'opération est chiffrable — c'est ce qui remplace le
 * tableau Word où états, remarques et mesures se mélangeaient.
 *
 * Servi au mobile via le détail de maintenance (checklistAttendue) : le
 * formulaire se dessine depuis l'API, une évolution du référentiel ne demande
 * pas de nouvelle version d'application.
 */

export const RESULTATS_CHECKLIST = ['CONFORME', 'NON_CONFORME', 'NA'] as const;
export type ResultatChecklist = (typeof RESULTATS_CHECKLIST)[number];

export interface ItemChecklist {
  cle: string;
  libelle: string;
  /** Présent = l'item attend une mesure ; le placeholder porte le format et l'unité. */
  mesure?: { placeholder: string };
}

export const CHECKLIST_SOLAIRE: Record<string, ItemChecklist[]> = {
  solaire_mensuel: [
    { cle: 'sol_energie_jour', libelle: 'Énergie moyenne délivrée par jour (monitoring)', mesure: { placeholder: 'kWh/jour' } },
    { cle: 'sol_marche_auto', libelle: 'État de fonctionnement : marche Auto / Manuel avec le GE', mesure: { placeholder: 'AUTO ou MANUEL' } },
    { cle: 'sol_deport_alarmes', libelle: 'Déport des alarmes, reconfigurations adaptées et backup des configurations' },
  ],
  solaire_nettoyage: [
    { cle: 'sol_nettoyage_panneaux', libelle: 'Nettoyage et dépoussiérage des panneaux (eau déminéralisée de préférence)' },
  ],
  solaire_semestriel: [
    // ── Panneaux ──
    { cle: 'sol_terre_panneaux', libelle: 'Vérification des mises à la terre', mesure: { placeholder: 'valeur en Ω' } },
    { cle: 'sol_inspection_panneaux', libelle: 'Inspection visuelle des panneaux et de leur structure', mesure: { placeholder: 'ex. 15 panneaux, 1 fissuré' } },
    { cle: 'sol_cablage', libelle: 'Câblage inter-panneaux et vers le régulateur / boîtes de jonction' },
    { cle: 'sol_fixations_sol', libelle: 'Points de fixation au sol' },
    { cle: 'sol_isc_voc', libelle: 'Mesure des Isc et Voc, string par string', mesure: { placeholder: 'ex. S1 8,1A/239V · S2 …' } },
    // ── Batteries (sèches : densité N/A d'office) ──
    { cle: 'sol_batt_visuel', libelle: 'Inspection visuelle des éléments batteries et bornes (propreté, corrosion, fissures)' },
    { cle: 'sol_batt_aerations', libelle: 'Aérations naturelles (propreté des filtres…)' },
    { cle: 'sol_batt_tension', libelle: 'Tension de chaque élément batterie', mesure: { placeholder: 'ex. 2,3V ×24 éléments' } },
    { cle: 'sol_batt_temperature', libelle: 'Température des éléments (batteries sèches — densité sans objet)', mesure: { placeholder: '°C' } },
    { cle: 'sol_batt_nettoyage', libelle: 'Nettoyage et dépoussiérage de l’ensemble des éléments batterie' },
    // ── Régulateur & coffret outdoor ──
    { cle: 'sol_coffret_fixation', libelle: 'Fixation du coffret outdoor' },
    { cle: 'sol_coffret_terre_parafoudres', libelle: 'Mise à la terre, câblage et état des parafoudres' },
    { cle: 'sol_coffret_ventilation', libelle: 'Fonctionnement de la ventilation forcée' },
    { cle: 'sol_coffret_alarmes', libelle: 'Absence d’alarme sur le régulateur' },
    { cle: 'sol_coffret_pv_strings', libelle: 'Niveaux de courant et tension PV sur chaque string', mesure: { placeholder: 'ex. S1 …A/…V · S2 …' } },
    { cle: 'sol_coffret_nettoyage', libelle: 'Nettoyage et dépoussiérage de l’ensemble' },
  ],
};

export const CHECKLIST_PAR_CLE: Record<string, ItemChecklist> = Object.fromEntries(
  Object.values(CHECKLIST_SOLAIRE).flat().map((i) => [i.cle, i])
);
