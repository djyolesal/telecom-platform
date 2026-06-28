import { prisma } from '../config/database';
import { env } from '../config/env';
import { GE_PARAMS } from '../utils/calculator';
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
    logger.info(`[settings] ${rows.length} paramètre(s) chargé(s) en cache`);
  } catch (e) {
    // BDD pas encore prête au boot → on garde les défauts, rechargé plus tard.
    logger.warn('[settings] chargement différé (défauts utilisés):', e);
  }
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
    // Carburant — stock
    { key: 'ge.seuilCritiqueLitres', label: 'Stock critique', groupe: 'Carburant — stock', unite: 'L', defaut: GE_PARAMS.seuilCritiqueLitres },
    { key: 'ge.seuilFaibleLitres', label: 'Stock faible', groupe: 'Carburant — stock', unite: 'L', defaut: GE_PARAMS.seuilFaibleLitres },
    { key: 'ge.prixLitreFCFA', label: 'Prix du litre gasoil', groupe: 'Carburant — stock', unite: 'FCFA', defaut: GE_PARAMS.prixLitreFCFA },
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
  ];
}

/** Valeurs effectives (défaut surchargé par la base) pour l'écran d'administration. */
export function effectiveSettings() {
  return settingsCatalog().map((s) => ({ ...s, valeur: getNum(s.key, s.defaut) }));
}
