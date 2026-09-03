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

export const TYPES_PYLONE = [
  { value: 'GREENFIELD', label: 'Greenfield' },
  { value: 'ROOFTOP', label: 'Rooftop' },
  { value: 'TGC_GREENFIELD', label: 'TGC-Greenfield' },
  { value: 'TROTTOIR', label: 'Trottoir' },
  { value: 'RURAL', label: 'Rural' },
  { value: 'LP_GREENFIELD', label: 'LP-Greenfield' },
];

export const FORMES_CUVE = [
  { value: 'RECTANGULAIRE', label: 'Rectangulaire' },
  { value: 'CYLINDRE_COUCHE', label: 'Cylindre couché' },
];

export const OUI_NON = [
  { value: 'true', label: 'Oui' },
  { value: 'false', label: 'Non' },
];

/**
 * Accès du camion citerne au site. « Livraison par pickup » = site à accès
 * difficile : le camion s'arrête en contrebas, un véhicule de transfert
 * termine la livraison. Réglage durable du site, surchargeable plan par plan.
 */
export const ACCES_OPTIONS = [
  { value: 'false', label: 'Camion citerne (accès direct)' },
  { value: 'true', label: 'Livraison par pickup (accès difficile)' },
];

export const ROLES = [
  { value: 'TECHNICIEN', label: 'Technicien' },
  { value: 'SUPERVISEUR', label: 'Superviseur' },
  { value: 'MANAGER', label: 'Manager' },
  { value: 'ADMIN', label: 'Administrateur' },
  { value: 'DIRECTION', label: 'Direction' },
  { value: 'TRANSPORTEUR', label: 'Transporteur carburant' },
  { value: 'NOC', label: 'NOC (supervision réseau)' },
];

export const TYPES_MAINTENANCE = [
  { value: 'PREVENTIVE', label: 'Préventive' },
  { value: 'CURATIVE', label: 'Curative' },
];

export const STATUTS_MAINTENANCE = [
  { value: 'PLANIFIEE', label: 'Planifiée' },
  { value: 'EN_COURS', label: 'En cours' },
  { value: 'SUSPENDUE', label: 'Suspendue' },
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
  { value: 'SOLAIRE', label: 'Solaire (photovoltaïque)' },
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

export const SCOPES_MAINTENANCE = [
  { value: 'PASSIVE', label: 'Passive' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'LES_DEUX', label: 'Passive + Active' },
  { value: 'SOLAIRE', label: 'Solaire (contrat dédié)' },
];

export const SCOPE_COLORS: Record<string, string> = {
  PASSIVE: 'bg-blue-100 text-blue-700',
  ACTIVE: 'bg-orange-100 text-orange-700',
  LES_DEUX: 'bg-purple-100 text-purple-700',
  SOLAIRE: 'bg-yellow-100 text-yellow-800',
};

// Catégories d'équipement considérées « passives » (→ relevés énergie à la clôture)
// Aligné sur l'API (PASSIVE_CATS) : AUTRE relève du périmètre PASSIF — la
// fiche affichait « Autre · active » alors que le serveur résout prestataire
// et équipes en passif pour cette catégorie.
export const PASSIVE_CATEGORIES = ['GE', 'BATTERIE', 'CLIMATISEUR', 'CABLE', 'AUTRE'];

/** Sources d'énergie présentes selon la configuration du site (aligné sur l'API). */
export function energySourcesForConfig(powerConfig?: string): string[] {
  switch (powerConfig) {
    case 'CEET_GE':
    case 'HYBRIDE_CEET_GE':
      return ['CEET', 'GE'];
    case 'CEET_UNIQUEMENT':
      return ['CEET'];
    case 'GE_UNIQUEMENT':
      return ['GE'];
    case 'HYBRIDE_GE':
      return ['GE', 'SOLAIRE'];
    case 'SOLAIRE_UNIQUEMENT':
      return ['SOLAIRE'];
    default:
      return [];
  }
}

// ── Libellés des statuts logistiques carburant ────────────────
// Jamais le code brut (CHARGE, PREVU…) à l'écran : « CHARGE » se lit
// « chargé » alors qu'il signifie « en livraison ».
export const L_STATUT_BC: Record<string, string> = {
  OUVERT: 'Ouvert', CLOTURE: 'Clôturé', ANNULE: 'Annulé',
};
export const L_STATUT_BL: Record<string, string> = {
  PLANIFIE: 'Planifié', CHARGE: 'En livraison', LIVRE: 'Livré', ANNULE: 'Annulé',
};
export const L_STATUT_LIGNE: Record<string, string> = {
  PREVU: 'Prévu', PARTIEL: 'Partiellement livré', LIVRE: 'Livré', ANNULE: 'Annulé',
};
