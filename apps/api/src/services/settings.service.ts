import { prisma } from '../config/database';
import { env } from '../config/env';
import { GE_PARAMS } from '../utils/calculator';
import { clearMemo } from '../utils/memo';
import { logger } from '../utils/logger';

/**
 * Surcouche de paramètres : les valeurs éditées en base (SystemSettings) priment
 * sur les défauts (variables d'environnement / constantes), sans redéploiement.
 * Cache mémoire rechargé au démarrage et après chaque mise à jour admin.
 */
const cache = new Map<string, unknown>();

export async function loadSettings(): Promise<void> {
  try {
    const rows = await prisma.systemSettings.findMany();
    cache.clear();
    for (const r of rows) cache.set(r.key, r.value);
    clearMemo(); // les seuils changent → purge les agrégats mémoïsés (effet immédiat)
    logger.info(`[settings] ${rows.length} paramètre(s) chargé(s) en cache`);
  } catch (e) {
    // BDD pas encore prête au boot → on garde les défauts, rechargé plus tard.
    logger.warn('[settings] chargement différé (défauts utilisés):', e);
  }
}

/** Valeur brute d'un paramètre (Json) — null si absente. */
export function getRaw(key: string): unknown {
  return cache.get(key) ?? null;
}

/**
 * Écriture d'un paramètre technique (ex. horodatage du dernier envoi de la
 * situation périodique) : persiste en base ET met le cache à jour.
 */
export async function setRaw(key: string, value: unknown): Promise<void> {
  await prisma.systemSettings.upsert({
    where: { key },
    update: { value: value as never },
    create: { key, value: value as never },
  });
  cache.set(key, value);
}

export function getNum(key: string, fallback: number): number {
  const v = cache.get(key);
  if (v == null) return fallback;
  const num = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(num) ? num : fallback;
}

/** Paramètres GE effectifs (défauts surchargés par SystemSettings). */
export function geParams() {
  return {
    ...GE_PARAMS,
    seuilCritiqueLitres: getNum('ge.seuilCritiqueLitres', GE_PARAMS.seuilCritiqueLitres),
    seuilFaibleLitres: getNum('ge.seuilFaibleLitres', GE_PARAMS.seuilFaibleLitres),
    prixLitreFCFA: getNum('ge.prixLitreFCFA', GE_PARAMS.prixLitreFCFA),
    // Garde-fous de repli de l'estimation conso (utilisés seulement quand un site
    // n'a ni compteur horaire ni historique ni médiane régionale exploitables).
    heuresMoisSecours: getNum('ge.heuresMoisSecours', GE_PARAMS.heuresMoisSecours),
    facteurChargeSecours: getNum('ge.facteurChargeSecours', GE_PARAMS.facteurChargeSecours),
  };
}

export interface SettingMeta { key: string; label: string; groupe: string; unite: string; defaut: number }

/** Catalogue des paramètres éditables, avec leur valeur par défaut (env/constantes). */
export function settingsCatalog(): SettingMeta[] {
  return [
    // Maintenance
    { key: 'maintenance.minDureeClotureMin', label: 'Durée min. avant clôture', groupe: 'Maintenance', unite: 'min', defaut: env.MIN_DUREE_CLOTURE_MIN },
    { key: 'maintenance.geofenceRadiusM', label: 'Rayon « sur site »', groupe: 'Maintenance', unite: 'm', defaut: env.GEOFENCE_RADIUS_M },
    { key: 'maintenance.seuilEcartGasoilPct', label: 'Tolérance écart gasoil', groupe: 'Maintenance', unite: '%', defaut: env.SEUIL_ECART_GASOIL_PCT },
    { key: 'maintenance.minPhotosMouvement', label: 'Photos min. mouvement d’actif', groupe: 'Maintenance', unite: 'photos', defaut: 2 },
    { key: 'ge.intervalleVidangeHeures', label: 'Intervalle vidange GE', groupe: 'Maintenance', unite: 'h', defaut: 250 },
    // Carburant — stock
    { key: 'ge.seuilCritiqueLitres', label: 'Stock critique', groupe: 'Carburant — stock', unite: 'L', defaut: GE_PARAMS.seuilCritiqueLitres },
    { key: 'ge.seuilFaibleLitres', label: 'Stock faible', groupe: 'Carburant — stock', unite: 'L', defaut: GE_PARAMS.seuilFaibleLitres },
    { key: 'ge.prixLitreFCFA', label: 'Prix du litre gasoil', groupe: 'Carburant — stock', unite: 'FCFA', defaut: GE_PARAMS.prixLitreFCFA },
    { key: 'carburant.seuilEcartLivraisonPct', label: 'Tolérance écart livraison', groupe: 'Carburant — stock', unite: '%', defaut: 5 },
    { key: 'carburant.seuilLivraisonMinPct', label: 'Livraison minimale (→ LIVRE)', groupe: 'Carburant — stock', unite: '%', defaut: 5 },
    { key: 'carburant.seuilAnomalieLitres', label: 'Plancher anti-bruit anomalie carburant', groupe: 'Carburant — stock', unite: 'L', defaut: 20 },
    { key: 'ge.heuresMoisSecours', label: 'Marche GE secours par défaut (repli sans données)', groupe: 'Carburant — stock', unite: 'h/mois', defaut: GE_PARAMS.heuresMoisSecours },
    { key: 'ge.facteurChargeSecours', label: 'Facteur de charge GE secours (repli)', groupe: 'Carburant — stock', unite: '', defaut: GE_PARAMS.facteurChargeSecours },
    // Carburant — manquants
    { key: 'manquant.delaiJours', label: 'Délai avant « en retard »', groupe: 'Carburant — manquants', unite: 'j', defaut: env.DELAI_MANQUANT_JOURS },
    { key: 'manquant.minLitres', label: 'Plancher anti-bruit', groupe: 'Carburant — manquants', unite: 'L', defaut: env.MANQUANT_MIN_LITRES },
    { key: 'manquant.critiqueLitres', label: 'Manquant site critique', groupe: 'Carburant — manquants', unite: 'L', defaut: env.MANQUANT_CRITIQUE_LITRES },
    { key: 'manquant.camionCritiqueLitres', label: 'Écart camion critique', groupe: 'Carburant — manquants', unite: 'L', defaut: env.MANQUANT_CAMION_CRITIQUE_LITRES },
    // Carburant — réapprovisionnement
    { key: 'appro.leadTimeJours', label: 'Délai d’approvisionnement', groupe: 'Carburant — réappro', unite: 'j', defaut: env.APPRO_LEAD_TIME_JOURS },
    { key: 'appro.securiteJours', label: 'Stock de sécurité', groupe: 'Carburant — réappro', unite: 'j', defaut: env.APPRO_STOCK_SECURITE_JOURS },
    { key: 'appro.horizonJours', label: 'Horizon de planification', groupe: 'Carburant — réappro', unite: 'j', defaut: env.APPRO_HORIZON_JOURS },
    { key: 'appro.camionCapaciteLitres', label: 'Capacité camion', groupe: 'Carburant — réappro', unite: 'L', defaut: env.CAMION_CAPACITE_LITRES },
    // SLA prestataires (engagements contractuels + pénalités)
    { key: 'sla.delaiResolutionMaxH', label: 'Délai max de résolution incident', groupe: 'SLA prestataires', unite: 'h', defaut: 24 },
    { key: 'sla.tauxPreventifMinPct', label: 'Taux de préventif minimal', groupe: 'SLA prestataires', unite: '%', defaut: 95 },
    { key: 'sla.tolerancePreventifJours', label: 'Tolérance retard préventif', groupe: 'SLA prestataires', unite: 'j', defaut: 7 },
    { key: 'sla.penaliteResolutionFCFA', label: 'Pénalité par incident hors délai', groupe: 'SLA prestataires', unite: 'FCFA', defaut: 50000 },
    { key: 'sla.penalitePreventifFCFA', label: 'Pénalité par point de préventif manquant', groupe: 'SLA prestataires', unite: 'FCFA', defaut: 100000 },
    // Notifications — situation périodique des dépassements (0 h d'intervalle = désactivée)
    { key: 'notifications.situationIntervalleH', label: 'Intervalle de la situation périodique', groupe: 'Notifications', unite: 'h', defaut: 3 },
    { key: 'notifications.situationSeuilH', label: 'Seuil de dépassement signalé', groupe: 'Notifications', unite: 'h', defaut: 1 },
    // Vraisemblance des saisies terrain (avertissements à confirmer, pas des blocages)
    { key: 'vraisemblance.margeCuvePct', label: 'Tolérance au-dessus de la capacité cuve', groupe: 'Vraisemblance saisies', unite: '%', defaut: 2 },
    { key: 'vraisemblance.maxHeuresGEParJour', label: 'Marche GE max par jour écoulé', groupe: 'Vraisemblance saisies', unite: 'h/j', defaut: 24 },
    { key: 'vraisemblance.maxKwhParJour', label: 'Consommation CEET max plausible', groupe: 'Vraisemblance saisies', unite: 'kWh/j', defaut: 1000 },
    { key: 'vraisemblance.margeStockLitres', label: 'Tolérance stock avant vs dernier niveau connu', groupe: 'Vraisemblance saisies', unite: 'L', defaut: 100 },
    // Empreinte carbone — facteurs d'émission (le solaire est à 0 par nature).
    { key: 'carbone.facteurGasoilKgCO2L', label: 'Facteur d’émission gasoil (combustion GE)', groupe: 'Empreinte carbone', unite: 'kgCO₂/L', defaut: CARBONE_DEFAULTS.gasoilKgCO2L },
    { key: 'carbone.facteurReseauKgCO2Kwh', label: 'Facteur d’émission réseau CEET', groupe: 'Empreinte carbone', unite: 'kgCO₂/kWh', defaut: CARBONE_DEFAULTS.reseauKgCO2Kwh },
  ];
}

/**
 * Référentiel des types de liaison de transmission (vocabulaire NOC).
 * Surchargeable sans redéploiement via la clé Json `topologie.typesLiaison`.
 */
export const TYPES_LIAISON_DEFAULTS = [
  { code: 'FIBER', libelle: 'Fibre optique', famille: 'FIBRE', constructeur: 'HUAWEI' },
  { code: 'TN', libelle: 'Fibre — OptiX TN', famille: 'FIBRE', constructeur: 'HUAWEI' },
  { code: 'ML', libelle: 'FH — Microwave Link', famille: 'FH', constructeur: 'ERICSSON' },
  { code: 'RTN', libelle: 'FH — RTN', famille: 'FH', constructeur: 'HUAWEI' },
];

export function typesLiaison(): typeof TYPES_LIAISON_DEFAULTS {
  const v = getRaw('topologie.typesLiaison');
  return Array.isArray(v) && v.length ? (v as typeof TYPES_LIAISON_DEFAULTS) : TYPES_LIAISON_DEFAULTS;
}

/** Facteurs d'émission par défaut (modifiables dans SystemSettings). */
export const CARBONE_DEFAULTS = {
  // Combustion d'un litre de gasoil ≈ 2,66 kgCO₂ (ordre de grandeur ADEME/DEFRA).
  gasoilKgCO2L: 2.66,
  // Réseau CEET (Togo) — mix à dominante thermique ; valeur indicative à ajuster.
  reseauKgCO2Kwh: 0.55,
};

/** Facteurs d'émission effectifs (défauts surchargés par SystemSettings). */
export function carboneFactors() {
  return {
    gasoilKgCO2L: getNum('carbone.facteurGasoilKgCO2L', CARBONE_DEFAULTS.gasoilKgCO2L),
    reseauKgCO2Kwh: getNum('carbone.facteurReseauKgCO2Kwh', CARBONE_DEFAULTS.reseauKgCO2Kwh),
  };
}

/** Valeurs effectives (défaut surchargé par la base) pour l'écran d'administration. */
export function effectiveSettings() {
  return settingsCatalog().map((s) => ({ ...s, valeur: getNum(s.key, s.defaut) }));
}
