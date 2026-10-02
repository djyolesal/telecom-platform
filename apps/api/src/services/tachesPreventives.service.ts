import { prisma } from '../config/database';
import { logger } from '../utils/logger';
import { AppError } from '../utils/AppError';
import { CONTRACTUAL_TASKS, Frequence, setTacheOverrides } from '../utils/tachesPreventives';
import { normaliserCout } from '../utils/coutTache';

/**
 * Charge les surcharges (libellé/fréquence) en cache mémoire. Appelé au démarrage
 * et après chaque édition admin (effet immédiat, sans redéploiement).
 */
export async function loadTacheOverrides(): Promise<void> {
  try {
    const rows = await prisma.tachePreventiveOverride.findMany();
    setTacheOverrides(rows.map((r) => ({ key: r.key, libelle: r.libelle, frequence: r.frequence as Frequence })));
    logger.info(`[taches] ${rows.length} surcharge(s) chargée(s) en cache`);
  } catch (e) {
    // BDD pas encore prête au boot → on garde les valeurs contractuelles, rechargé plus tard.
    logger.warn('[taches] chargement des surcharges différé (valeurs contractuelles utilisées):', e);
  }
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
}

/** Vue admin : chaque tâche contractuelle avec ses valeurs par défaut et effectives. */
export async function tacheOverridesCatalog(): Promise<TacheOverrideRow[]> {
  const [overrides, couts] = await Promise.all([
    prisma.tachePreventiveOverride.findMany(),
    coutsTaches(),
  ]);
  const byKey = new Map(overrides.map((o) => [o.key, o]));
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
