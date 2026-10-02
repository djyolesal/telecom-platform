import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { definirCoutTache, resetTacheOverride, tacheOverridesCatalog, coutsTaches } from './tachesPreventives.service';
import { getCatalogue } from '../controllers/taches.controller';

/**
 * Prix des tâches préventives (préparation de la facturation mensuelle).
 *
 * Ce que ces tests gardent :
 *  - le prix survit à « Restaurer le défaut » (table à part) ;
 *  - « pas de prix » (null) et « gratuit » (0) restent deux états distincts ;
 *  - le catalogue servi à TOUS les comptes ne porte jamais le prix.
 */

jest.mock('../config/database', () => {
  const delegates: Record<string, Record<string, jest.Mock>> = {};
  const prisma = new Proxy({} as Record<string, unknown>, {
    get(_c, prop: string) {
      if (!delegates[prop]) {
        delegates[prop] = {
          findMany: jest.fn().mockResolvedValue([]),
          findUnique: jest.fn().mockResolvedValue(null),
          findFirst: jest.fn().mockResolvedValue(null),
          upsert: jest.fn().mockResolvedValue({}),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          count: jest.fn().mockResolvedValue(0),
        };
      }
      return delegates[prop];
    },
  });
  return { prisma };
});
jest.mock('../services/storage.service', () => ({ getObjectBuffer: jest.fn().mockRejectedValue(new Error('pas de MinIO en test')) }));
jest.mock('../services/ficheValidation.service', () => ({
  ...jest.requireActual('../services/ficheValidation.service'),
  buildFicheValidationXlsx: jest.fn().mockResolvedValue(Buffer.from('xlsx')),
}));

const p = prisma as unknown as Record<string, Record<string, jest.Mock>>;
const cout = () => p.tachePreventiveCout;

beforeEach(() => {
  for (const d of Object.values(p)) for (const f of Object.values(d)) f.mockClear();
  cout().findMany.mockResolvedValue([]);
  cout().findUnique.mockResolvedValue(null);
});

describe('définir le prix d’une tâche', () => {
  it('refuse une clé de tâche inconnue', async () => {
    await expect(definirCoutTache('tache_inconnue', 1000, 'u1')).rejects.toMatchObject({ statusCode: 404 });
    expect(cout().upsert).not.toHaveBeenCalled();
  });

  it('pose un premier prix et renvoie l’avant (aucun) et l’après', async () => {
    const r = await definirCoutTache('desherbage', 15000, 'u1');
    expect(r).toEqual({ avant: null, apres: 15000 });
    expect(cout().upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { tacheKey: 'desherbage' },
      create: { tacheKey: 'desherbage', coutUnitaire: 15000, updatedBy: 'u1' },
    }));
  });

  it('modifie un prix existant et trace l’ancien', async () => {
    cout().findUnique.mockResolvedValue({ tacheKey: 'desherbage', coutUnitaire: '15000.00' });
    const r = await definirCoutTache('desherbage', '18 000,50', 'u1');
    expect(r).toEqual({ avant: 15000, apres: 18000.5 });
  });

  // Le zéro est un prix : prestation incluse. Ne PAS le traiter comme « vide ».
  it('enregistre le zéro comme un vrai prix, sans supprimer la ligne', async () => {
    const r = await definirCoutTache('clim', 0, 'u1');
    expect(r.apres).toBe(0);
    expect(cout().upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ coutUnitaire: 0 }) }));
    expect(cout().deleteMany).not.toHaveBeenCalled();
  });

  it('retire le prix quand le champ est vidé', async () => {
    cout().findUnique.mockResolvedValue({ tacheKey: 'clim', coutUnitaire: '5000' });
    for (const vide of [null, '', '  ']) {
      cout().deleteMany.mockClear();
      const r = await definirCoutTache('clim', vide, 'u1');
      expect(r).toEqual({ avant: 5000, apres: null });
      expect(cout().deleteMany).toHaveBeenCalledWith({ where: { tacheKey: 'clim' } });
    }
    expect(cout().upsert).not.toHaveBeenCalled();
  });

  it('refuse un montant invalide sans toucher à la base', async () => {
    await expect(definirCoutTache('clim', 'abc', 'u1')).rejects.toMatchObject({ statusCode: 422 });
    await expect(definirCoutTache('clim', -5, 'u1')).rejects.toMatchObject({ statusCode: 422 });
    expect(cout().upsert).not.toHaveBeenCalled();
    expect(cout().deleteMany).not.toHaveBeenCalled();
  });
});

describe('le prix et « Restaurer le défaut »', () => {
  // La raison d'être de la table à part : restaurer un libellé ne doit pas
  // emporter un prix qui pilote des factures.
  it('restaurer une surcharge ne touche pas au prix', async () => {
    await resetTacheOverride('desherbage');
    expect(p.tachePreventiveOverride.deleteMany).toHaveBeenCalledWith({ where: { key: 'desherbage' } });
    expect(cout().deleteMany).not.toHaveBeenCalled();
    expect(cout().upsert).not.toHaveBeenCalled();
  });
});

describe('lecture des prix', () => {
  it('le catalogue d’administration joint le prix, null quand la tâche n’est pas tarifée', async () => {
    cout().findMany.mockResolvedValue([
      { tacheKey: 'desherbage', coutUnitaire: '2500.00' },
      { tacheKey: 'clim', coutUnitaire: '0.00' },
    ]);
    const lignes = await tacheOverridesCatalog();
    const par = Object.fromEntries(lignes.map((l) => [l.key, l.cout]));
    expect(par.desherbage).toBe(2500);
    expect(par.clim).toBe(0);          // gratuit : un prix, pas une absence
    expect(par.extincteurs).toBeNull(); // non tarifé
  });

  it('coutsTaches renvoie une table clé → montant', async () => {
    cout().findMany.mockResolvedValue([{ tacheKey: 'desherbage', coutUnitaire: '2500.00' }]);
    const m = await coutsTaches();
    expect(m.get('desherbage')).toBe(2500);
    expect(m.has('clim')).toBe(false);
  });
});

describe('le prix ne fuit pas', () => {
  // /taches-preventives est servi à tout compte connecté - prestataires et
  // techniciens compris. Un prix est une donnée commerciale.
  it('le catalogue public ne porte aucun champ de prix, même quand des prix existent', async () => {
    cout().findMany.mockResolvedValue([{ tacheKey: 'desherbage', coutUnitaire: '2500.00' }]);
    const json = jest.fn();
    await getCatalogue({} as Request, { json } as unknown as Response);
    const reponse = json.mock.calls[0][0];
    expect(reponse.data.length).toBeGreaterThan(0);
    expect(JSON.stringify(reponse)).not.toMatch(/cout|coût|prix/i);
  });
});
