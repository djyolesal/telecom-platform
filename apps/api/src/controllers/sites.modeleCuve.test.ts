import { Request, Response } from 'express';
import { updateSite, updateCuveSite } from './sites.controller';
import { prisma } from '../config/database';

/**
 * Rattacher un site à un modèle de cuve : la capacité du site devient celle du
 * modèle, et rien de ce que le formulaire envoie ne l'en sépare.
 */

jest.mock('../config/database', () => ({
  prisma: {
    site: { findUnique: jest.fn(), update: jest.fn() },
    modeleCuve: { findUnique: jest.fn() },
  },
}));
jest.mock('../services/audit.service', () => ({ auditLog: jest.fn() }));
jest.mock('../services/cache.service', () => ({ cacheService: { invalidate: jest.fn() } }));
jest.mock('../utils/perimetre', () => ({ sitePerimetre: jest.fn(async () => ({})), assertSiteInPerimetre: jest.fn() }));

const p = prisma as unknown as {
  site: { findUnique: jest.Mock; update: jest.Mock };
  modeleCuve: { findUnique: jest.Mock };
};

const M5000 = { id: 'm5000', nom: 'Cuve 5000 L', isActive: true, capaciteLitres: 5000 };
const ANCIEN = { id: 'mOld', nom: 'Cuve 1000 L', isActive: false, capaciteLitres: 1000 };

async function modifier(site: Record<string, unknown>, body: Record<string, unknown>) {
  p.site.findUnique.mockResolvedValue({ id: 's1', powerConfig: 'CEET_GE', lotSolaireId: null, ...site });
  const req = { params: { id: 's1' }, body, user: { id: 'u1' } } as unknown as Request;
  const json = jest.fn();
  const next = jest.fn();
  await updateSite(req, { json } as unknown as Response, next);
  return { json, next, data: p.site.update.mock.calls[0]?.[0].data };
}

beforeEach(() => {
  jest.clearAllMocks();
  p.site.update.mockImplementation(async ({ data }) => data);
  p.modeleCuve.findUnique.mockImplementation(async ({ where }) => [M5000, ANCIEN].find((m) => m.id === where.id) ?? null);
});

describe('modèle de cuve sur la fiche site', () => {
  it('rattacher : la capacité devient celle du modèle, même si le formulaire en envoie une autre', async () => {
    const { data, next } = await modifier({ modeleCuveId: null }, { modeleCuveId: 'm5000', cuveVolumeLitres: 4800 });
    expect(next).not.toHaveBeenCalled();
    expect(data.modeleCuveId).toBe('m5000');
    expect(data.cuveVolumeLitres).toBe(5000);
  });

  it('site déjà rattaché : une capacité saisie seule ne l’emporte pas sur le modèle', async () => {
    const { data } = await modifier({ modeleCuveId: 'm5000' }, { cuveVolumeLitres: 4800, nom: 'X' });
    expect(data.cuveVolumeLitres).toBe(5000);
  });

  it('détacher (chaîne vide du formulaire) : plus de modèle, la capacité saisie redevient libre', async () => {
    const { data } = await modifier({ modeleCuveId: 'm5000' }, { modeleCuveId: '', cuveVolumeLitres: 4800 });
    expect(data.modeleCuveId).toBeNull();
    expect(data.cuveVolumeLitres).toBe(4800);
  });

  it('refuse un modèle désactivé à l’attribution, mais le garde sur un site qui le porte déjà', async () => {
    const refus = await modifier({ modeleCuveId: null }, { modeleCuveId: 'mOld' });
    expect(refus.next.mock.calls[0][0].message).toMatch(/désactivé/);
    jest.clearAllMocks();
    p.site.update.mockImplementation(async ({ data }) => data);
    p.modeleCuve.findUnique.mockImplementation(async ({ where }) => [M5000, ANCIEN].find((m) => m.id === where.id) ?? null);
    const garde = await modifier({ modeleCuveId: 'mOld' }, { nom: 'Y' });
    expect(garde.next).not.toHaveBeenCalled();
    expect(garde.data.cuveVolumeLitres).toBe(1000);
  });

  it('refuse un modèle inconnu', async () => {
    const { next } = await modifier({ modeleCuveId: null }, { modeleCuveId: 'zz' });
    expect(next.mock.calls[0][0].statusCode).toBe(422);
  });
});

describe('mesure terrain de la cuve (mobile)', () => {
  it('refusée sur un site rattaché à un modèle : déjà calculable, et la capacité écraserait celle du modèle', async () => {
    p.site.findUnique.mockResolvedValue({ id: 's1', modeleCuve: { nom: 'Cuve 5000 L' } });
    const req = { params: { id: 's1' }, body: { cuveVolumeLitres: 4000 }, user: { id: 'u1' } } as unknown as Request;
    const next = jest.fn();
    await updateCuveSite(req, { json: jest.fn() } as unknown as Response, next);
    expect(next.mock.calls[0][0].statusCode).toBe(409);
    expect(next.mock.calls[0][0].message).toMatch(/Cuve 5000 L/);
    expect(p.site.update).not.toHaveBeenCalled();
  });
});
