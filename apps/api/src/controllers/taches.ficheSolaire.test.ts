import { Request, Response } from 'express';
import { getFicheValidation } from './taches.controller';
import { prisma } from '../config/database';

/**
 * Fiche de validation SOLAIRE par lot : le périmètre des sites est construit
 * sur site.lotSolaireId (lots solaires), mais le comptage des maintenances
 * réalisées filtrait sur site.lotId (lot passif) — la fiche sous-comptait
 * les réalisations. Le filtre doit suivre le même découpage que le contrat.
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
        };
      }
      return delegates[prop];
    },
  });
  return { prisma };
});
jest.mock('../services/storage.service', () => ({ getObjectBuffer: jest.fn().mockRejectedValue(new Error('pas de MinIO en test')) }));
jest.mock('../services/ficheValidation.service', () => ({ buildFicheValidationXlsx: jest.fn().mockResolvedValue(Buffer.from('xlsx')) }));

const p = prisma as unknown as Record<string, Record<string, jest.Mock>>;

function fauxReqRes(query: Record<string, string>) {
  const req = { query } as unknown as Request;
  const res = { setHeader: jest.fn(), send: jest.fn() } as unknown as Response;
  const next = jest.fn();
  return { req, res, next };
}

describe('getFicheValidation — filtre des réalisations par lot', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    p.prestataire.findUnique.mockResolvedValue({ id: 'presta1', nom: 'Presta Test', adresse: null, rccm: null, nif: null, contactCommercial: null, contactTechnique: null, logoPath: null });
    p.lot.findUnique.mockResolvedValue({ nom: 'LOT S1', region: 'Kara' });
  });

  it('contrat SOLAIRE + lot : les maintenances sont filtrées sur site.lotSolaireId', async () => {
    const { req, res, next } = fauxReqRes({ prestataire_id: 'presta1', annee: '2026', mois: '8', lot_id: 'lotS1', contrat: 'SOLAIRE' });
    await getFicheValidation(req, res, next as never);
    expect(next).not.toHaveBeenCalled();
    const where = p.maintenance.findMany.mock.calls[0][0].where;
    expect(where.site).toEqual({ lotSolaireId: 'lotS1' });
  });

  it('contrat PASSIF + lot : les maintenances restent filtrées sur site.lotId', async () => {
    const { req, res, next } = fauxReqRes({ prestataire_id: 'presta1', annee: '2026', mois: '8', lot_id: 'lotP1' });
    await getFicheValidation(req, res, next as never);
    expect(next).not.toHaveBeenCalled();
    const where = p.maintenance.findMany.mock.calls[0][0].where;
    expect(where.site).toEqual({ lotId: 'lotP1' });
  });
});
