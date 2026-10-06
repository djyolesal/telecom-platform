import { Request, Response } from 'express';
import { delierAppareil } from './users.controller';
import { prisma } from '../config/database';
import { revoquerSession } from '../services/session.service';
import { auditLog } from '../services/audit.service';

/**
 * Délier un téléphone ferme la session MOBILE du compte - et elle seule.
 *
 * Avant, la liaison tombait mais la session restait ouverte jusqu'à 30 jours :
 * un téléphone perdu ou volé gardait son accès, et le compte ne pouvait pas se
 * relier (la liaison ne se fait qu'au login).
 */

jest.mock('../config/database', () => ({ prisma: { user: { findUnique: jest.fn(), update: jest.fn() } } }));
jest.mock('../services/audit.service', () => ({ auditLog: jest.fn() }));
jest.mock('../services/session.service', () => ({ revoquerSession: jest.fn(), revoquerToutesSessions: jest.fn() }));

const p = prisma as unknown as { user: { findUnique: jest.Mock; update: jest.Mock } };

async function delier() {
  const req = { params: { id: 'u1' }, user: { id: 'admin1' } } as unknown as Request;
  const json = jest.fn();
  const next = jest.fn();
  await delierAppareil(req, { json } as unknown as Response, next);
  return { json, next };
}

beforeEach(() => {
  jest.clearAllMocks();
  p.user.findUnique.mockResolvedValue({ id: 'u1', appareilLabel: 'TECNO KM5' });
  p.user.update.mockResolvedValue({});
});

describe('délier un appareil', () => {
  it('efface la liaison ET ferme la session mobile', async () => {
    const { json, next } = await delier();
    expect(next).not.toHaveBeenCalled();
    expect(p.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'u1' },
      data: expect.objectContaining({ appareilId: null, appareilLabel: null, appareilLieLe: null }),
    }));
    expect(revoquerSession).toHaveBeenCalledWith('u1', 'MOBILE');
    expect(json).toHaveBeenCalledWith({ success: true });
  });

  it('ne ferme PAS le portail web', async () => {
    await delier();
    for (const [, plt] of (revoquerSession as jest.Mock).mock.calls) expect(plt).toBe('MOBILE');
  });

  it('la liaison est effacée avant la session : un échec ne laisse pas un téléphone lié et déconnecté', async () => {
    const ordre: string[] = [];
    p.user.update.mockImplementation(async () => { ordre.push('liaison'); return {}; });
    (revoquerSession as jest.Mock).mockImplementation(async () => { ordre.push('session'); });
    await delier();
    expect(ordre).toEqual(['liaison', 'session']);
  });

  it('trace la fermeture de la session dans le journal', async () => {
    await delier();
    expect(auditLog).toHaveBeenCalledWith('admin1', 'UPDATE', 'users', 'u1',
      expect.objectContaining({ action: 'delier_appareil', sessionMobileFermee: true }), expect.anything());
  });

  it('un utilisateur inconnu ne ferme rien', async () => {
    p.user.findUnique.mockResolvedValue(null);
    const { next } = await delier();
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 404 });
    expect(revoquerSession).not.toHaveBeenCalled();
    expect(p.user.update).not.toHaveBeenCalled();
  });
});
