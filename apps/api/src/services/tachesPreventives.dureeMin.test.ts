import { Request } from 'express';
import { prisma } from '../config/database';
import {
  definirDureeMinTache, dureeMinCloture, dureeMinExigee, dureesMinTaches, loadTacheOverrides,
  resetTacheOverride, tacheOverridesCatalog,
} from './tachesPreventives.service';

/**
 * Durée minimale avant clôture PAR TÂCHE.
 *
 * Ce que ces tests gardent :
 *  - une tâche sans réglage, une curative (pas de clé) prennent la durée globale ;
 *  - la durée de la tâche ne s'applique qu'aux APK b52+ : un APK antérieur n'a
 *    contrôlé que la globale, il est jugé sur la même règle (sinon une clôture
 *    faite hors réseau serait refusée au rejeu, technicien reparti) ;
 *  - « Restaurer le défaut » n'efface pas la durée (table à part) ;
 *  - saisie bornée à des minutes entières 0..720, champ vide = retour à la globale.
 */

jest.mock('../config/database', () => {
  const delegates: Record<string, Record<string, jest.Mock>> = {};
  const prisma = new Proxy({} as Record<string, unknown>, {
    get(_c, prop: string) {
      if (!delegates[prop]) {
        delegates[prop] = {
          findMany: jest.fn().mockResolvedValue([]),
          findUnique: jest.fn().mockResolvedValue(null),
          upsert: jest.fn().mockResolvedValue({}),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        };
      }
      return delegates[prop];
    },
  });
  return { prisma };
});

const p = prisma as unknown as Record<string, Record<string, jest.Mock>>;
const durees = () => p.tachePreventiveDuree;
const GLOBALE = 60; // MIN_DUREE_CLOTURE_MIN par défaut, aucun paramètre en base en test
const apk = (version?: string) => ({ headers: version ? { 'x-app-version': version } : {} }) as unknown as Request;

/** Simule l'état en base puis recharge le cache, comme au démarrage de l'API. */
async function enBase(lignes: Array<{ tacheKey: string; dureeMinClotureMin: number }>) {
  durees().findMany.mockResolvedValue(lignes);
  await loadTacheOverrides();
}

beforeEach(async () => {
  for (const d of Object.values(p)) for (const f of Object.values(d)) f.mockClear();
  durees().findUnique.mockResolvedValue(null);
  await enBase([]);
});

describe('durée effective', () => {
  it('tâche sans réglage ou maintenance sans tâche : durée globale', async () => {
    await enBase([{ tacheKey: 'desherbage', dureeMinClotureMin: 20 }]);
    expect(dureeMinCloture('extincteurs')).toBe(GLOBALE);
    expect(dureeMinCloture(null)).toBe(GLOBALE);
    expect(dureeMinCloture('desherbage')).toBe(20);
  });

  it('0 est une durée valide (pas de minimum), distincte de « pas de réglage »', async () => {
    await enBase([{ tacheKey: 'serrures', dureeMinClotureMin: 0 }]);
    expect(dureeMinCloture('serrures')).toBe(0);
  });

  it('servie au mobile par /config sous forme { clé: minutes }', async () => {
    await enBase([{ tacheKey: 'desherbage', dureeMinClotureMin: 20 }, { tacheKey: 'clim', dureeMinClotureMin: 90 }]);
    expect(dureesMinTaches()).toEqual({ desherbage: 20, clim: 90 });
  });
});

describe('durée exigée à la clôture selon l’APK', () => {
  beforeEach(() => enBase([{ tacheKey: 'clim', dureeMinClotureMin: 120 }, { tacheKey: 'desherbage', dureeMinClotureMin: 20 }]));

  it('APK b52+ (y compris code découpé par ABI) : durée de la tâche', () => {
    expect(dureeMinExigee(apk('1.9.2+52'), 'clim')).toBe(120);
    expect(dureeMinExigee(apk('1.9.2+2052'), 'desherbage')).toBe(20);
  });

  it('APK antérieur : durée globale, plus longue OU plus courte que celle de la tâche', () => {
    expect(dureeMinExigee(apk('1.9.1+2051'), 'clim')).toBe(GLOBALE);
    expect(dureeMinExigee(apk('1.9.1+51'), 'desherbage')).toBe(GLOBALE);
  });

  it('sans en-tête de version (portail, vieux APK) : durée globale', () => {
    expect(dureeMinExigee(apk(), 'clim')).toBe(GLOBALE);
  });
});

describe('définir la durée d’une tâche', () => {
  it('refuse une clé inconnue', async () => {
    await expect(definirDureeMinTache('tache_inconnue', 30, 'u1')).rejects.toMatchObject({ statusCode: 404 });
    expect(durees().upsert).not.toHaveBeenCalled();
  });

  it.each([[-5], [721], [12.5], ['abc'], ['1h']])('refuse %p', async (v) => {
    await expect(definirDureeMinTache('desherbage', v, 'u1')).rejects.toMatchObject({ statusCode: 422 });
    expect(durees().upsert).not.toHaveBeenCalled();
  });

  it('pose une durée (texte du formulaire accepté) et renvoie l’avant/après', async () => {
    const r = await definirDureeMinTache('desherbage', ' 30 ', 'u1');
    expect(r).toEqual({ avant: null, apres: 30 });
    expect(durees().upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { tacheKey: 'desherbage' },
      create: { tacheKey: 'desherbage', dureeMinClotureMin: 30, updatedBy: 'u1' },
    }));
  });

  it('champ vidé : supprime le réglage (retour à la globale)', async () => {
    durees().findUnique.mockResolvedValue({ tacheKey: 'desherbage', dureeMinClotureMin: 30 });
    const r = await definirDureeMinTache('desherbage', '', 'u1');
    expect(r).toEqual({ avant: 30, apres: null });
    expect(durees().deleteMany).toHaveBeenCalledWith({ where: { tacheKey: 'desherbage' } });
    expect(durees().upsert).not.toHaveBeenCalled();
  });

  it('« Restaurer le défaut » ne touche pas la durée', async () => {
    await resetTacheOverride('desherbage');
    expect(durees().deleteMany).not.toHaveBeenCalled();
  });

  it('le catalogue admin montre la durée propre et la globale', async () => {
    durees().findMany.mockResolvedValue([{ tacheKey: 'desherbage', dureeMinClotureMin: 25 }]);
    const lignes = await tacheOverridesCatalog();
    expect(lignes.find((l) => l.key === 'desherbage')).toMatchObject({ dureeMin: 25, dureeMinGlobale: GLOBALE });
    expect(lignes.find((l) => l.key === 'clim')).toMatchObject({ dureeMin: null });
  });
});
