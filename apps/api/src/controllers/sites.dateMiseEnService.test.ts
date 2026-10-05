import { Request, Response } from 'express';
import { updateSite, createSite } from './sites.controller';
import { prisma } from '../config/database';

/**
 * Enregistrer un site portant une date de mise en service.
 *
 * Le formulaire envoie « 2022-10-03 », la colonne est de type DATE, et la base
 * refuse une date seule comme une chaîne vide : tout site qui avait une date
 * devenait impossible à modifier, avec pour seul message « Données invalides ».
 * Le défaut est resté invisible parce qu'aucun test n'exerçait la modification
 * d'un site AVEC date - ce fichier comble ce trou.
 */

jest.mock('../config/database', () => ({
  prisma: {
    site: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
    groupeElectrogene: { create: jest.fn() },
  },
}));
jest.mock('../services/audit.service', () => ({ auditLog: jest.fn() }));
jest.mock('../services/cache.service', () => ({ cacheService: { invalidate: jest.fn() } }));

const p = prisma as unknown as {
  site: { findUnique: jest.Mock; update: jest.Mock; create: jest.Mock };
  groupeElectrogene: { create: jest.Mock };
};

const SITE = { id: 's1', code: 'PLT-010', powerConfig: 'CEET_GE', lotSolaireId: null };

async function modifier(body: Record<string, unknown>) {
  const req = { params: { id: 's1' }, body, user: { id: 'u1' } } as unknown as Request;
  const json = jest.fn();
  const next = jest.fn();
  await updateSite(req, { json } as unknown as Response, next);
  return { json, next };
}

/** Données effectivement envoyées à la base par le dernier `update`. */
const envoye = () => p.site.update.mock.calls[0][0].data;

beforeEach(() => {
  jest.clearAllMocks();
  p.site.findUnique.mockResolvedValue(SITE);
  p.site.update.mockImplementation(async ({ data }) => ({ ...SITE, ...data }));
});

describe('modifier un site : date de mise en service', () => {
  it('accepte la date du formulaire et la transmet à la base comme une Date', async () => {
    const { json, next } = await modifier({ dateMiseEnService: '2022-10-03' });
    expect(next).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalled();
    expect(envoye().dateMiseEnService).toEqual(new Date('2022-10-03T00:00:00.000Z'));
  });

  it('un site dont on renvoie la date telle que l’API l’a servie reste modifiable', async () => {
    // L'API sert un horodatage complet ; la page le tronque à 10 caractères.
    const servie = '2019-05-14T00:00:00.000Z';
    await modifier({ dateMiseEnService: servie.slice(0, 10), ville: 'Sokodé' });
    expect(envoye().dateMiseEnService).toEqual(new Date(servie));
    expect(envoye().ville).toBe('Sokodé');
  });

  it('retirer la date envoie null', async () => {
    await modifier({ dateMiseEnService: '' });
    expect(envoye().dateMiseEnService).toBeNull();
    p.site.update.mockClear();
    await modifier({ dateMiseEnService: null });
    expect(envoye().dateMiseEnService).toBeNull();
  });

  it('une date impossible est refusée en 422 clair, sans écrire en base', async () => {
    const { next, json } = await modifier({ dateMiseEnService: '2022-02-31' });
    expect(json).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 422 });
    expect(next.mock.calls[0][0].message).toMatch(/Date de mise en service/);
    expect(p.site.update).not.toHaveBeenCalled();
  });

  it('ne touche pas à la date quand elle n’est pas dans la requête', async () => {
    await modifier({ ville: 'Kara' });
    expect(envoye()).not.toHaveProperty('dateMiseEnService');
  });

  it('une nature de site vide devient null au lieu d’une chaîne vide', async () => {
    await modifier({ typeSite: '' });
    expect(envoye().typeSite).toBeNull();
    p.site.update.mockClear();
    await modifier({ typeSite: 'CENTRE_TECHNIQUE' });
    expect(envoye().typeSite).toBe('CENTRE_TECHNIQUE');
  });
});

describe('créer un site : date de mise en service', () => {
  it('accepte la même saisie', async () => {
    p.site.create.mockImplementation(async ({ data }) => ({ id: 'n1', statutGE: 'PAS_DE_GE', ...data }));
    const req = {
      body: { nom: 'N', code: 'C', region: 'R', powerConfig: 'CEET_UNIQUEMENT', statutGE: 'PAS_DE_GE', dateMiseEnService: '2021-03-15', typeSite: '' },
      user: { id: 'u1' },
    } as unknown as Request;
    const next = jest.fn();
    await createSite(req, { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response, next);
    expect(next).not.toHaveBeenCalled();
    const data = p.site.create.mock.calls[0][0].data;
    expect(data.dateMiseEnService).toEqual(new Date('2021-03-15T00:00:00.000Z'));
    expect(data.typeSite).toBeNull();
  });
});
