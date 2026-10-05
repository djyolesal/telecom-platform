import { Request, Response } from 'express';
import { getReleves, getReleveById } from './releves.controller';
import { prisma } from '../config/database';

/**
 * Le code du site est réservé à l'administrateur : ni la liste des relevés ni sa
 * fiche ne le servent aux autres rôles. Les écrans qui les affichent ne
 * montrent que le nom du site, rien ne dépend de ce champ.
 */

jest.mock('../config/database', () => ({
  prisma: { releveEnergie: { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn() } },
}));
jest.mock('../utils/perimetre', () => ({
  sitePerimetre: jest.fn().mockResolvedValue({}),
  isRestreint: (p: Record<string, unknown>) => Object.keys(p).length > 0,
  assertSiteInPerimetre: jest.fn().mockResolvedValue(undefined),
}));

const p = prisma as unknown as { releveEnergie: { findMany: jest.Mock; count: jest.Mock; findUnique: jest.Mock } };

const SITE = { id: 's1', nom: 'Site A', code: 'PLT-010', region: 'Plateaux', telephoneSite: '+228 90 00 00 00' };
const RELEVE = { id: 'r1', siteId: 's1', origine: null, maintenance: null, site: SITE };

const appeler = async (fn: typeof getReleves, role: string, params: Record<string, string> = {}) => {
  const req = { query: {}, params, user: { id: 'u1', role } } as unknown as Request;
  const json = jest.fn();
  const next = jest.fn();
  await fn(req, { json } as unknown as Response, next);
  return { json, next };
};

beforeEach(() => {
  jest.clearAllMocks();
  p.releveEnergie.findMany.mockResolvedValue([RELEVE]);
  p.releveEnergie.count.mockResolvedValue(1);
  p.releveEnergie.findUnique.mockResolvedValue(RELEVE);
});

describe('liste des relevés : code du site', () => {
  it('ne le demande pas à la base hors admin', async () => {
    await appeler(getReleves, 'MANAGER');
    expect(p.releveEnergie.findMany.mock.calls[0][0].include.site.select).not.toHaveProperty('code');
  });

  it('le demande pour l’admin', async () => {
    await appeler(getReleves, 'ADMIN');
    expect(p.releveEnergie.findMany.mock.calls[0][0].include.site.select.code).toBe(true);
  });

  it('garde le nom et la région du site', async () => {
    await appeler(getReleves, 'SUPERVISEUR');
    const select = p.releveEnergie.findMany.mock.calls[0][0].include.site.select;
    expect(select).toMatchObject({ nom: true, region: true });
  });
});

describe('fiche d’un relevé : code du site', () => {
  it('est retiré pour un manager, le reste du site est conservé', async () => {
    const { json } = await appeler(getReleveById as typeof getReleves, 'MANAGER', { id: 'r1' });
    const site = json.mock.calls[0][0].data.site;
    expect(site).not.toHaveProperty('code');
    expect(site.nom).toBe('Site A');
    expect(site.region).toBe('Plateaux');
  });

  it('reste servi à l’admin', async () => {
    const { json } = await appeler(getReleveById as typeof getReleves, 'ADMIN', { id: 'r1' });
    expect(json.mock.calls[0][0].data.site.code).toBe('PLT-010');
  });

  // On ne modifie pas l'objet partagé : une deuxième réponse (admin) ne doit pas
  // hériter du retrait fait pour la première.
  it('ne mute pas la donnée lue', async () => {
    await appeler(getReleveById as typeof getReleves, 'MANAGER', { id: 'r1' });
    expect(SITE.code).toBe('PLT-010');
  });
});
