import { Request, Response } from 'express';
import { contactablesPourSite } from './zonesMaintenance.controller';
import { prisma } from '../config/database';

/**
 * « Technicien contacté » (NOC) : suggestions = équipe FME de la zone du site,
 * puis techniciens PASSIFS du prestataire qui tient le passif du lot.
 */

jest.mock('../config/database', () => ({ prisma: { site: { findUnique: jest.fn() }, user: { findMany: jest.fn() } } }));
jest.mock('../services/audit.service', () => ({ auditLog: jest.fn() }));
jest.mock('../services/cache.service', () => ({ cacheService: { invalidate: jest.fn() } }));

const p = prisma as unknown as { site: { findUnique: jest.Mock }; user: { findMany: jest.Mock } };
const contact = (nom: string, actif = true) => ({ nom, prenom: 'K', telephone: '9000', societe: 'ACTIF SA', actif });

async function appeler(siteId = 's1') {
  const json = jest.fn(); const next = jest.fn();
  await contactablesPourSite({ query: { site_id: siteId } } as unknown as Request, { json } as unknown as Response, next);
  return { data: json.mock.calls[0]?.[0]?.data, next };
}

beforeEach(() => {
  jest.clearAllMocks();
  p.user.findMany.mockResolvedValue([{ nom: 'TECH', prenom: 'Pa', telephone: '9111', prestataire: { nom: 'PASSIF SA' } }]);
});

describe('contactables pour un site', () => {
  it('équipe FME (responsable, puis équipiers actifs) et passifs du titulaire passif du lot', async () => {
    p.site.findUnique.mockResolvedValue({
      zoneMaintenance: { nom: 'LOME 1', responsable: contact('NOGLO'), membres: [{ contact: contact('DOSSOU') }, { contact: contact('PARTI', false) }] },
      lot: { assignments: [{ prestataireId: 'pa', scope: 'PASSIVE' }, { prestataireId: 'ac', scope: 'ACTIVE' }] },
    });
    const { data } = await appeler();
    expect(data.zone).toBe('LOME 1');
    expect(data.fme.map((f: { nom: string; role: string }) => `${f.role}:${f.nom}`)).toEqual(['Responsable:NOGLO', 'Équipier:DOSSOU']);
    expect(p.user.findMany.mock.calls[0][0].where).toMatchObject({ role: 'TECHNICIEN', equipe: 'PASSIVE', prestataireId: { in: ['pa'] } });
    expect(data.passifs[0]).toMatchObject({ nom: 'TECH', societe: 'PASSIF SA' });
  });

  it('site sans zone ni titulaire passif : pas de FME, tous les techniciens passifs', async () => {
    p.site.findUnique.mockResolvedValue({ zoneMaintenance: null, lot: null });
    const { data } = await appeler();
    expect(data.fme).toEqual([]);
    expect(p.user.findMany.mock.calls[0][0].where.prestataireId).toBeUndefined();
    expect(data.passifsDuLot).toBe(false);
  });

  it('site requis', async () => {
    const { next } = await appeler('');
    expect(next.mock.calls[0][0].statusCode).toBe(400);
  });
});
