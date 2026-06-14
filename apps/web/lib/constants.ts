// Listes d'options alignées sur les enums Prisma (apps/api/prisma/schema.prisma)

export const REGIONS = ['Maritime', 'Plateaux', 'Centrale', 'Kara', 'Savanes'];

export const POWER_CONFIGS = [
  { value: 'CEET_GE', label: 'CEET + GE' },
  { value: 'CEET_UNIQUEMENT', label: 'CEET uniquement' },
  { value: 'GE_UNIQUEMENT', label: 'GE uniquement' },
  { value: 'HYBRIDE_GE', label: 'Hybride GE' },
  { value: 'SOLAIRE_UNIQUEMENT', label: 'Solaire uniquement' },
  { value: 'HYBRIDE_CEET_GE', label: 'Hybride CEET+GE' },
];

export const STATUTS_GE = [
  { value: 'GE_PERMANENT', label: 'GE permanent' },
  { value: 'GE_SECOURS', label: 'GE secours' },
  { value: 'PAS_DE_GE', label: 'Pas de GE' },
];

export const ROLES = [
  { value: 'TECHNICIEN', label: 'Technicien' },
  { value: 'SUPERVISEUR', label: 'Superviseur' },
  { value: 'MANAGER', label: 'Manager' },
  { value: 'ADMIN', label: 'Administrateur' },
  { value: 'DIRECTION', label: 'Direction' },
];

export const TYPES_MAINTENANCE = [
  { value: 'PREVENTIVE', label: 'Préventive' },
  { value: 'CURATIVE', label: 'Curative' },
];

export const STATUTS_MAINTENANCE = [
  { value: 'PLANIFIEE', label: 'Planifiée' },
  { value: 'EN_COURS', label: 'En cours' },
  { value: 'TERMINEE', label: 'Terminée' },
  { value: 'ANNULEE', label: 'Annulée' },
];

export const CATEGORIES_EQUIPEMENT = [
  { value: 'GE', label: 'Groupe électrogène' },
  { value: 'BATTERIE', label: 'Batterie' },
  { value: 'CLIMATISEUR', label: 'Climatiseur' },
  { value: 'ANTENNE', label: 'Antenne' },
  { value: 'CABLE', label: 'Câble' },
  { value: 'RESEAU', label: 'Réseau' },
  { value: 'AUTRE', label: 'Autre' },
];

export const SOURCES_ENERGIE = [
  { value: 'CEET', label: 'CEET' },
  { value: 'GE', label: 'Groupe électrogène' },
  { value: 'SOLAIRE', label: 'Solaire' },
];

export const TYPES_INCIDENT = [
  { value: 'ALARME', label: 'Alarme' },
  { value: 'COUPURE_CEET', label: 'Coupure CEET' },
  { value: 'COUPURE_TOTALE', label: 'Coupure totale' },
  { value: 'PANNE_GE', label: 'Panne GE' },
  { value: 'INTRUSION', label: 'Intrusion' },
  { value: 'VANDALISME', label: 'Vandalisme' },
  { value: 'AUTRE', label: 'Autre' },
];

export const SEVERITES = [
  { value: 'CRITIQUE', label: 'Critique' },
  { value: 'MAJEUR', label: 'Majeur' },
  { value: 'MINEUR', label: 'Mineur' },
  { value: 'INFORMATIF', label: 'Informatif' },
];

export const STATUTS_INCIDENT = [
  { value: 'OUVERT', label: 'Ouvert' },
  { value: 'EN_COURS', label: 'En cours' },
  { value: 'RESOLU', label: 'Résolu' },
  { value: 'CLOS', label: 'Clos' },
];

export const regionOptions = REGIONS.map((r) => ({ value: r, label: r }));
