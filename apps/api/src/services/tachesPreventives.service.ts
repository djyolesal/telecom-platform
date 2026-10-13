import { prisma } from '../config/database';
import { logger } from '../utils/logger';
import { AppError } from '../utils/AppError';
import { CONTRACTUAL_TASKS, Frequence, setTacheOverrides } from '../utils/tachesPreventives';
import { normaliserCout } from '../utils/coutTache';
import { getNum } from './settings.service';
import { env } from '../config/env';
import { Request } from 'express';
import { appAuMoins, BUILD_DUREE_PAR_TACHE } from '../utils/versionApp';

/**
 * Charge les surcharges (libellé/fréquence) en cache mémoire. Appelé au démarrage
 * et après chaque édition admin (effet immédiat, sans redéploiement).
 */
export async function loadTacheOverrides(): Promise<void> {
  try {
    const [rows, durees] = await Promise.all([
      prisma.tachePreventiveOverride.findMany(),
      prisma.tachePreventiveDuree.findMany(),
    ]);
    setTacheOverrides(rows.map((r) => ({ key: r.key, libelle: r.libelle, frequence: r.frequence as Frequence })));
    dureesMin = new Map(durees.map((d) => [d.tacheKey, d.dureeMinClotureMin]));
    logger.info(`[taches] ${rows.length} surcharge(s), ${durees.length} durée(s) min. chargée(s) en cache`);
  } catch (e) {
    // BDD pas encore prête au boot → on garde les valeurs contractuelles, rechargé plus tard.
    logger.warn('[taches] chargement des surcharges différé (valeurs contractuelles utilisées):', e);
  }
}

// ── Durée minimale avant clôture, par tâche ─────────────────────────────────

/** Durées propres aux tâches (minutes), en cache : lues à chaque clôture et à chaque /config. */
let dureesMin = new Map<string, number>();

/** Durée minimale de travail avant clôture, en minutes, PAR DÉFAUT (toutes tâches). */
export const dureeMinGlobale = (): number => getNum('maintenance.minDureeClotureMin', env.MIN_DUREE_CLOTURE_MIN);

/** Durées propres aux tâches, servies au mobile par /config (b52+). */
export const dureesMinTaches = (): Record<string, number> => Object.fromEntries(dureesMin);

/**
 * Durée minimale exigée pour clôturer une maintenance de cette tâche : la
 * sienne si l'admin en a fixé une, la globale sinon (curatives, mouvements,
 * tâches sans réglage).
 */
export function dureeMinCloture(tacheKey: string | null | undefined): number {
  return (tacheKey ? dureesMin.get(tacheKey) : undefined) ?? dureeMinGlobale();
}

/**
 * Durée exigée À LA CLÔTURE pour la requête qui arrive. La durée propre à la
 * tâche ne vaut que pour un APK qui la contrôle lui-même (b52+) : un APK
 * antérieur n'a vérifié que la durée globale, et l'exiger plus longue ici
 * refuserait au rejeu de la file une clôture faite hors réseau, technicien déjà
 * reparti du site. Il reste donc jugé sur la globale (portail compris).
 */
export function dureeMinExigee(req: Request, tacheKey: string | null | undefined): number {
  return appAuMoins(req, BUILD_DUREE_PAR_TACHE) ? dureeMinCloture(tacheKey) : dureeMinGlobale();
}

/** Garde-fou de saisie : 12 h de travail minimum serait une faute de frappe. */
export const DUREE_MIN_TACHE_MAX = 720;

/**
 * Pose, modifie ou retire (`null` / champ vide : retour à la durée globale) la
 * durée minimale d'une tâche. Renvoie l'avant et l'après, pour le journal.
 */
export async function definirDureeMinTache(
  key: string,
  brut: unknown,
  updatedBy: string,
): Promise<{ avant: number | null; apres: number | null }> {
  if (!CONTRACTUAL_TASKS.some((t) => t.key === key)) throw new AppError('Clé de tâche inconnue.', 404);
  let duree: number | null;
  if (brut === null || brut === undefined || (typeof brut === 'string' && brut.trim() === '')) {
    duree = null;
  } else {
    const n = typeof brut === 'number' ? brut : Number(String(brut).trim());
    if (!Number.isInteger(n) || n < 0 || n > DUREE_MIN_TACHE_MAX) {
      throw new AppError(`Durée invalide : un nombre entier de minutes entre 0 et ${DUREE_MIN_TACHE_MAX} est attendu.`, 422);
    }
    duree = n;
  }
  const existant = await prisma.tachePreventiveDuree.findUnique({ where: { tacheKey: key } });
  if (duree === null) {
    await prisma.tachePreventiveDuree.deleteMany({ where: { tacheKey: key } });
  } else {
    await prisma.tachePreventiveDuree.upsert({
      where: { tacheKey: key },
      create: { tacheKey: key, dureeMinClotureMin: duree, updatedBy },
      update: { dureeMinClotureMin: duree, updatedBy },
    });
  }
  await loadTacheOverrides();
  return { avant: existant?.dureeMinClotureMin ?? null, apres: duree };
}

export interface TacheOverrideRow {
  key: string;
  numero: number;
  categorie: string;
  cible: string;
  libelleDefaut: string;
  frequenceDefaut: Frequence;
  libelle: string;
  frequence: Frequence;
  isOverridden: boolean;
  /** Prix d'UNE exécution sur UN site, en FCFA. null = tâche non tarifée (≠ 0). */
  cout: number | null;
  /** Durée min. avant clôture propre à la tâche (min). null = durée globale. */
  dureeMin: number | null;
  /** Durée globale en vigueur, pour l'afficher à côté d'un champ vide. */
  dureeMinGlobale: number;
}

/** Vue admin : chaque tâche contractuelle avec ses valeurs par défaut et effectives. */
export async function tacheOverridesCatalog(): Promise<TacheOverrideRow[]> {
  const [overrides, couts, durees] = await Promise.all([
    prisma.tachePreventiveOverride.findMany(),
    coutsTaches(),
    prisma.tachePreventiveDuree.findMany(),
  ]);
  const byKey = new Map(overrides.map((o) => [o.key, o]));
  const dureeParCle = new Map(durees.map((d) => [d.tacheKey, d.dureeMinClotureMin]));
  const globale = dureeMinGlobale();
  return CONTRACTUAL_TASKS.map((t) => {
    const o = byKey.get(t.key);
    return {
      key: t.key,
      numero: t.numero,
      categorie: t.categorie,
      cible: t.cible,
      libelleDefaut: t.libelle,
      frequenceDefaut: t.frequence,
      libelle: o?.libelle ?? t.libelle,
      frequence: (o?.frequence as Frequence | undefined) ?? t.frequence,
      isOverridden: !!o,
      cout: couts.get(t.key) ?? null,
      dureeMin: dureeParCle.get(t.key) ?? null,
      dureeMinGlobale: globale,
    };
  });
}

/**
 * Prix des tâches, par clé. VOLONTAIREMENT absent du catalogue en mémoire
 * (`effectiveCatalogue`) et de `/taches-preventives` : ce catalogue est servi à
 * tous les comptes connectés, prestataires et techniciens compris, et un prix
 * est une donnée commerciale. Seuls les écrans d'administration et le futur
 * calcul de facture passent par ici.
 */
export async function coutsTaches(): Promise<Map<string, number>> {
  const lignes = await prisma.tachePreventiveCout.findMany();
  return new Map(lignes.map((l) => [l.tacheKey, Number(l.coutUnitaire)]));
}

/**
 * Pose, modifie ou retire (`null`) le prix d'une tâche. Renvoie l'avant et
 * l'après : un prix pilote des montants facturés, son historique se trace.
 */
export async function definirCoutTache(
  key: string,
  brut: unknown,
  updatedBy: string,
): Promise<{ avant: number | null; apres: number | null }> {
  if (!CONTRACTUAL_TASKS.some((t) => t.key === key)) throw new AppError('Clé de tâche inconnue.', 404);
  const cout = normaliserCout(brut);
  const existant = await prisma.tachePreventiveCout.findUnique({ where: { tacheKey: key } });
  const avant = existant ? Number(existant.coutUnitaire) : null;

  if (cout === null) {
    await prisma.tachePreventiveCout.deleteMany({ where: { tacheKey: key } });
  } else {
    await prisma.tachePreventiveCout.upsert({
      where: { tacheKey: key },
      create: { tacheKey: key, coutUnitaire: cout, updatedBy },
      update: { coutUnitaire: cout, updatedBy },
    });
  }
  return { avant, apres: cout };
}

/** Édite le libellé/fréquence effectifs d'une tâche contractuelle (clé figée). */
export async function upsertTacheOverride(key: string, data: { libelle: string; frequence: Frequence }, updatedBy: string) {
  if (!CONTRACTUAL_TASKS.some((t) => t.key === key)) throw new AppError('Clé de tâche inconnue.', 404);
  const libelle = data.libelle?.trim();
  if (!libelle) throw new AppError('Libellé requis.', 422);
  await prisma.tachePreventiveOverride.upsert({
    where: { key },
    create: { key, libelle, frequence: data.frequence as never, updatedBy },
    update: { libelle, frequence: data.frequence as never, updatedBy },
  });
  await loadTacheOverrides();
}

/** Restaure les valeurs contractuelles par défaut d'une tâche. */
export async function resetTacheOverride(key: string) {
  await prisma.tachePreventiveOverride.deleteMany({ where: { key } });
  await loadTacheOverrides();
}
