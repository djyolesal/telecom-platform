/**
 * Libellés FRANÇAIS des énumérations, pour tout contenu qui atteint un
 * utilisateur métier : PDF, exports xlsx, notifications push/SMS, messages
 * d'erreur. Jamais de code SCREAMING_SNAKE face à un prestataire ou un
 * dirigeant. (Exception assumée : les exports « modèle ré-importable », qui
 * doivent garder les codes bruts pour l'aller-retour d'import.)
 *
 * Centralise les tables partielles qui coexistaient (NATURE_MOUVEMENT du
 * pdf.service, LABELS d'actifs.controller, LABEL_STATUT du daily-recap…).
 */

export const L_TYPE_MAINTENANCE: Record<string, string> = {
  PREVENTIVE: 'Préventive',
  CURATIVE: 'Curative',
};

export const L_STATUT_MAINTENANCE: Record<string, string> = {
  PLANIFIEE: 'Planifiée',
  EN_COURS: 'En cours',
  SUSPENDUE: 'Suspendue',
  TERMINEE: 'Terminée',
  ANNULEE: 'Annulée',
};

export const L_CATEGORIE_EQUIPEMENT: Record<string, string> = {
  GE: 'Groupe électrogène',
  BATTERIE: 'Batterie',
  CLIMATISEUR: 'Climatiseur',
  ANTENNE: 'Antenne',
  CABLE: 'Câble',
  RESEAU: 'Réseau',
  SOLAIRE: 'Solaire',
  AUTRE: 'Autre',
};

export const L_SEVERITE: Record<string, string> = {
  CRITIQUE: 'Critique',
  MAJEUR: 'Majeur',
  MINEUR: 'Mineur',
  INFORMATIF: 'Informatif',
};

export const L_STATUT_INCIDENT: Record<string, string> = {
  OUVERT: 'Ouvert',
  EN_COURS: 'En cours',
  RESOLU: 'Résolu',
  CLOS: 'Clos',
};

export const L_STATUT_BC: Record<string, string> = {
  OUVERT: 'ouvert',
  CLOTURE: 'clôturé',
  ANNULE: 'annulé',
};

export const L_STATUT_LIGNE_LIVRAISON: Record<string, string> = {
  PREVU: 'Prévu',
  PARTIEL: 'Partiel',
  LIVRE: 'Livré',
  ANNULE: 'Annulé',
};

export const L_NIVEAU_STOCK: Record<string, string> = {
  VIDE: 'Cuve vide',
  CRITIQUE: 'Stock critique',
  FAIBLE: 'Stock faible',
  OK: 'Stock suffisant',
  NA: 'Non évalué',
};

/** Libellé d'un code, avec le code lui-même en repli lisible. */
export const libelle = (table: Record<string, string>, code?: string | null): string =>
  (code && table[code]) || code || '—';
