import { CategorieEquipement } from '@prisma/client';

/** Fréquence contractuelle d'une tâche préventive. */
export type Frequence = 'MENSUELLE' | 'TRIMESTRIELLE' | 'SEMESTRIELLE' | 'AU_BESOIN';

export const FREQUENCE_MOIS: Record<Frequence, number | null> = {
  MENSUELLE: 1,
  TRIMESTRIELLE: 3,
  SEMESTRIELLE: 6,
  AU_BESOIN: null,
};

export const FREQUENCE_LABEL: Record<Frequence, string> = {
  MENSUELLE: 'Tous les mois',
  TRIMESTRIELLE: '1 fois / 3 mois',
  SEMESTRIELLE: '1 fois / 6 mois',
  AU_BESOIN: 'Au besoin',
};

/** Attributs de site nécessaires à l'évaluation de l'éligibilité. */
export interface SiteEligibilite {
  typePylone: string | null;
  hasClimatiseur: boolean;
  hasExtincteurs: boolean;
  powerConfig: string;
  statutGE: string;
  cuveVolumeLitres: unknown; // Decimal | number | null
}

const hasCuve = (s: SiteEligibilite) => s.cuveVolumeLitres != null && Number(s.cuveVolumeLitres) > 0;
const hasGE = (s: SiteEligibilite) => s.statutGE !== 'PAS_DE_GE';
// Sites équipés de solaire : solaire pur ou hybrides (le rapport contractuel
// « maintenance des sites hybrides » couvre ces configurations).
const aDuSolaire = (s: SiteEligibilite) =>
  ['SOLAIRE_UNIQUEMENT', 'HYBRIDE_GE', 'HYBRIDE_CEET_GE'].includes(s.powerConfig);

export interface TachePreventive {
  numero: number;
  key: string;
  libelle: string;
  categorie: CategorieEquipement;
  frequence: Frequence;
  cible: string; // description des sites concernés
  eligible: (s: SiteEligibilite) => boolean;
}

/** Catalogue contractuel des tâches préventives (prestataire passif). */
export const CONTRACTUAL_TASKS: TachePreventive[] = [
  {
    numero: 1, key: 'entretien_pylone', libelle: 'Entretien pylône, serrage des boulons', categorie: 'AUTRE',
    frequence: 'SEMESTRIELLE', cible: 'Tous sauf pylônes TGC-Greenfield et LP-Greenfield',
    eligible: (s) => s.typePylone !== 'TGC_GREENFIELD' && s.typePylone !== 'LP_GREENFIELD',
  },
  {
    numero: 2, key: 'controle_terre', libelle: 'Contrôle valeur terre et normalisation du réseau de terre', categorie: 'AUTRE',
    frequence: 'SEMESTRIELLE', cible: 'Tous sauf pylônes TGC-Greenfield et LP-Greenfield',
    eligible: (s) => s.typePylone !== 'TGC_GREENFIELD' && s.typePylone !== 'LP_GREENFIELD',
  },
  {
    numero: 3, key: 'desherbage', libelle: 'Désherbage et nettoyage du site', categorie: 'AUTRE',
    frequence: 'MENSUELLE', cible: 'Tous sauf pylônes Rooftop',
    eligible: (s) => s.typePylone !== 'ROOFTOP',
  },
  {
    numero: 4, key: 'extincteurs', libelle: 'Contrôle et entretien des extincteurs', categorie: 'AUTRE',
    frequence: 'SEMESTRIELLE', cible: 'Sites avec extincteurs',
    eligible: (s) => s.hasExtincteurs,
  },
  {
    numero: 5, key: 'deratisation', libelle: 'Dératisation, désinsectisation, chasse abeilles/reptiles', categorie: 'AUTRE',
    frequence: 'TRIMESTRIELLE', cible: 'Tous les sites',
    eligible: () => true,
  },
  {
    numero: 6, key: 'tgbt_avr_onduleur', libelle: 'Entretien TGBT, AVR et onduleur', categorie: 'AUTRE',
    frequence: 'MENSUELLE', cible: 'Tous les sites',
    eligible: () => true,
  },
  {
    numero: 7, key: 'clim', libelle: 'Maintenance climatiseurs', categorie: 'CLIMATISEUR',
    frequence: 'TRIMESTRIELLE', cible: 'Sites avec climatiseurs',
    eligible: (s) => s.hasClimatiseur,
  },
  {
    numero: 8, key: 'serrures', libelle: 'Réparation/remplacement serrures et cadenas', categorie: 'AUTRE',
    frequence: 'AU_BESOIN', cible: 'Tous les sites',
    eligible: () => true,
  },
  {
    numero: 9, key: 'ge_production', libelle: 'Entretien et vidange GE (production, non connecté CEET)', categorie: 'GE',
    frequence: 'MENSUELLE', cible: 'Énergie GE uniquement ou Hybride+GE',
    eligible: (s) => s.powerConfig === 'GE_UNIQUEMENT' || s.powerConfig === 'HYBRIDE_GE',
  },
  {
    numero: 10, key: 'ge_secours', libelle: 'Entretien et vidange GE (secours, connecté CEET)', categorie: 'GE',
    frequence: 'MENSUELLE', cible: 'Sites à statut GE secours',
    eligible: (s) => s.statutGE === 'GE_SECOURS',
  },
  {
    numero: 11, key: 'depotage', libelle: 'Suivi des livraisons et relevé carburant (dépotage)', categorie: 'GE',
    frequence: 'AU_BESOIN', cible: 'Sites avec GE et cuve',
    eligible: (s) => hasGE(s) && hasCuve(s),
  },
  {
    numero: 12, key: 'curage_cuve', libelle: 'Curage et nettoyage des cuves à gasoil', categorie: 'GE',
    frequence: 'SEMESTRIELLE', cible: 'Sites avec cuve',
    eligible: (s) => hasCuve(s),
  },
  // ── Contrat SOLAIRE (scope contractuel séparé de la passive — même contrat
  // pour tous les prestataires solaires ; fréquences du PV contractuel). Les
  // 17 opérations du contrat deviennent la checklist typée de la clôture ;
  // ici, les VISITES qui se planifient, regroupées par fréquence.
  // ⚠️ Libellés COURTS : ils sont recopiés dans `maintenances.equipement`
  // (VarChar 100) et s'affichent dans les listes, PDF et exports. Le détail
  // des opérations vit dans CHECKLIST_SOLAIRE, pas ici. ──
  {
    numero: 13, key: 'solaire_mensuel',
    libelle: 'Visite mensuelle solaire (production, mode de marche, alarmes)',
    categorie: 'SOLAIRE', frequence: 'MENSUELLE', cible: 'Sites solaires et hybrides',
    eligible: aDuSolaire,
  },
  {
    numero: 14, key: 'solaire_nettoyage',
    libelle: 'Nettoyage et dépoussiérage des panneaux solaires (eau déminéralisée de préférence)',
    categorie: 'SOLAIRE', frequence: 'TRIMESTRIELLE', cible: 'Sites solaires et hybrides',
    eligible: aDuSolaire,
  },
  {
    numero: 15, key: 'solaire_semestriel',
    libelle: 'Grande visite semestrielle solaire (panneaux, batteries, régulateur)',
    categorie: 'SOLAIRE', frequence: 'SEMESTRIELLE', cible: 'Sites solaires et hybrides',
    eligible: aDuSolaire,
  },
];

export const TASK_BY_KEY: Record<string, TachePreventive> = Object.fromEntries(
  CONTRACTUAL_TASKS.map((t) => [t.key, t])
);

/**
 * Surcharges admin (libellé + fréquence uniquement — la clé, la catégorie et
 * l'éligibilité restent du code). Cache mémoire mutable via setTacheOverrides(),
 * appelé par le service au démarrage et après chaque édition (effet immédiat,
 * même principe que les seuils de settings.service.ts).
 */
export interface TacheOverride { libelle: string; frequence: Frequence }
const overrides = new Map<string, TacheOverride>();

export function setTacheOverrides(rows: Array<{ key: string; libelle: string; frequence: Frequence }>): void {
  overrides.clear();
  for (const r of rows) overrides.set(r.key, { libelle: r.libelle, frequence: r.frequence });
}

function withOverride(t: TachePreventive): TachePreventive {
  const o = overrides.get(t.key);
  return o ? { ...t, libelle: o.libelle, frequence: o.frequence } : t;
}

/** Catalogue effectif (valeurs par défaut surchargées par l'admin si présentes). */
export function effectiveCatalogue(): TachePreventive[] {
  return CONTRACTUAL_TASKS.map(withOverride);
}

/** Tâches contractuelles applicables à un site donné (libellé/fréquence effectifs). */
export function tachesForSite(s: SiteEligibilite): TachePreventive[] {
  return CONTRACTUAL_TASKS.filter((t) => t.eligible(s)).map(withOverride);
}

/** Tâches périodiques (hors « au besoin ») applicables — celles qui se planifient. */
export function tachesPlanifiables(s: SiteEligibilite): TachePreventive[] {
  return tachesForSite(s).filter((t) => FREQUENCE_MOIS[t.frequence] != null);
}
