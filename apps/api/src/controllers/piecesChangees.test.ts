import { Request, Response } from 'express';
import { listPiecesChangees } from './piecesChangees.controller';
import { prisma } from '../config/database';

/**
 * Règles de la liste des pièces changées qui ne se voient pas à l'écran et qu'un
 * refactoring pourrait défaire sans qu'aucun test d'affichage ne s'en aperçoive :
 *  - le CODE du site n'est servi, ni cherchable, que pour l'ADMIN ;
 *  - une intervention invalidée ne compte pas (on ne facture pas un travail refusé) ;
 *  - une date illisible est refusée, pas ignorée.
 */

jest.mock('../config/database', () => ({
  prisma: { pieceRechange: { findMany: jest.fn(), count: jest.fn() } },
}));
jest.mock('../utils/perimetre', () => ({
  sitePerimetre: jest.fn().mockResolvedValue({}),
  contratMaintenancePerimetre: jest.fn().mockResolvedValue({}),
  isRestreint: (p: Record<string, unknown>) => Object.keys(p).length > 0,
}));

const p = prisma as unknown as { pieceRechange: { findMany: jest.Mock; count: jest.Mock } };

const LIGNE = {
  id: 'p1', nom: 'Courroie', reference: null, quantite: 2, coutUnitaire: null, pieceRefId: null, pieceRef: null,
  maintenance: {
    id: 'm1', reference: 'MNT-1', type: 'CURATIVE', statut: 'TERMINEE', siteId: 's1',
    dateFin: new Date('2026-09-10T10:00:00Z'), datePlanifiee: new Date('2026-09-10T08:00:00Z'), invalideeLe: null,
    site: { id: 's1', nom: 'Site A', code: 'PLT-010', region: 'Plateaux' },
    prestataire: { id: 'pr1', nom: 'Presta' },
    technicien: null,
  },
};

async function appeler(role: string, query: Record<string, string> = {}) {
  const req = { query, user: { id: 'u1', role } } as unknown as Request;
  const json = jest.fn();
  const res = { json } as unknown as Response;
  const next = jest.fn();
  await listPiecesChangees(req, res, next);
  return { json, next };
}

/** `where` effectivement passé à la première requête (celle de la page). */
const whereUtilise = () => p.pieceRechange.findMany.mock.calls[0][0].where;

beforeEach(() => {
  jest.clearAllMocks();
  p.pieceRechange.findMany.mockResolvedValue([LIGNE]);
  p.pieceRechange.count.mockResolvedValue(1);
});

describe('pièces changées : le code du site est réservé à l’ADMIN', () => {
  it('n’est pas servi à un manager', async () => {
    const { json } = await appeler('MANAGER');
    const ligne = json.mock.calls[0][0].data[0];
    expect(ligne.site.nom).toBe('Site A');
    expect(ligne.site).not.toHaveProperty('code');
  });

  it('est servi à l’admin', async () => {
    const { json } = await appeler('ADMIN');
    expect(json.mock.calls[0][0].data[0].site.code).toBe('PLT-010');
  });

  // Ne pas servir le code mais laisser la recherche le deviner (« PLT-0 » → N
  // résultats) le divulguerait par la bande.
  it('ne se découvre pas par la recherche hors admin', async () => {
    // Le code du CATALOGUE de pièces (pieceRef.code) reste cherchable : seul le
    // code du SITE est visé, d'où la clause précise.
    const cherchaitLeCodeSite = (where: { OR: Array<Record<string, unknown>> }) =>
      where.OR.some((c) => {
        const site = (c.maintenance as { site?: Record<string, unknown> } | undefined)?.site;
        return site != null && 'code' in site;
      });

    await appeler('MANAGER', { search: 'PLT' });
    expect(cherchaitLeCodeSite(whereUtilise())).toBe(false);
    // …et la recherche par nom de site, elle, est toujours là.
    expect(JSON.stringify(whereUtilise().OR)).toContain('"site":{"nom"');

    p.pieceRechange.findMany.mockClear();
    await appeler('ADMIN', { search: 'PLT' });
    expect(cherchaitLeCodeSite(whereUtilise())).toBe(true);
  });
});

describe('pièces changées : périmètre et validité', () => {
  it('exclut par défaut les interventions invalidées', async () => {
    await appeler('MANAGER');
    expect(whereUtilise().maintenance.invalideeLe).toBeNull();
  });

  it('les inclut sur demande explicite seulement', async () => {
    await appeler('MANAGER', { inclure_invalidees: '1' });
    expect(whereUtilise().maintenance).not.toHaveProperty('invalideeLe');
  });

  it('rattache une intervention à sa date de fin, à défaut à sa date planifiée', async () => {
    await appeler('MANAGER', { date_debut: '2026-09-01', date_fin: '2026-09-30' });
    const [cond] = whereUtilise().maintenance.AND;
    expect(cond.OR).toHaveLength(2);
    expect(cond.OR[0]).toHaveProperty('dateFin');
    expect(cond.OR[1].dateFin).toBeNull();
    // Fin INCLUSIVE : la borne haute est le 1er octobre, exclu.
    expect(cond.OR[0].dateFin.lt.getMonth()).toBe(9);
    expect(cond.OR[0].dateFin.lt.getDate()).toBe(1);
  });

  it('refuse une date illisible au lieu de l’ignorer', async () => {
    const { next, json } = await appeler('MANAGER', { date_debut: '30/09/2026' });
    expect(json).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0].statusCode).toBe(422);
  });

  it('refuse une fin antérieure au début', async () => {
    const { next } = await appeler('MANAGER', { date_debut: '2026-09-30', date_fin: '2026-09-01' });
    expect(next.mock.calls[0][0].statusCode).toBe(422);
  });
});

describe('pièces changées : synthèse', () => {
  // « Batterie 12 V 100 Ah » et « batterie 12v100ah » sont la même pièce : la
  // synthèse les regroupe, comme le rapprochement au catalogue.
  it('regroupe les graphies d’une même pièce libre', async () => {
    const libre = (id: string, nom: string, quantite: number) => ({
      ...LIGNE, id, nom, quantite,
      maintenance: { ...LIGNE.maintenance, id: `m-${id}` },
    });
    p.pieceRechange.findMany.mockResolvedValue([
      libre('a', 'Batterie 12 V 100 Ah', 2), libre('b', 'batterie 12v100ah', 1), libre('c', 'Courroie', 4),
    ]);
    p.pieceRechange.count.mockResolvedValue(3);
    const { json } = await appeler('MANAGER');
    const { parPiece, totaux } = json.mock.calls[0][0].synthese;
    expect(parPiece).toHaveLength(2);
    expect(parPiece.find((x: { quantite: number }) => x.quantite === 3)).toBeDefined();
    expect(totaux.quantite).toBe(7);
    expect(totaux.sansCatalogue).toBe(3);
  });
});
