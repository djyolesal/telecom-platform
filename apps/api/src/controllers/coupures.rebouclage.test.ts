import { resoudreIncidentSiPlusDeCoupure } from './coupuresReseau.controller';

/**
 * Rebouclage coupure → incident : la résolution ne doit JAMAIS précéder
 * l'ouverture (contrainte SQL incidents_resolution_apres_ouverture). Cas réel
 * KPERGOU/BASSADJI : incident créé à la PRISE EN CHARGE, coupure clôturée
 * ensuite avec un rétablissement antérieur — la clôture partait en 500.
 */

jest.mock('../server', () => ({ io: { of: () => ({ emit: jest.fn() }), emit: jest.fn() } }));
jest.mock('../config/database', () => {
  const delegates: Record<string, Record<string, jest.Mock>> = {};
  const prisma = new Proxy({} as Record<string, unknown>, {
    get(_c, prop: string) {
      if (prop === '$queryRaw' || prop === '$executeRaw') return jest.fn().mockResolvedValue([]);
      if (prop === '$transaction') return jest.fn();
      if (!delegates[prop]) {
        delegates[prop] = {
          findMany: jest.fn().mockResolvedValue([]),
          findUnique: jest.fn().mockResolvedValue(null),
          findFirst: jest.fn().mockResolvedValue(null),
          count: jest.fn().mockResolvedValue(0),
          create: jest.fn().mockResolvedValue({}),
          update: jest.fn().mockResolvedValue({}),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        };
      }
      return delegates[prop];
    },
  });
  return { prisma };
});

function fauxTx(incident: Record<string, unknown>, coupuresOuvertes = 0) {
  const update = jest.fn().mockResolvedValue({});
  const tx = {
    coupureReseau: { count: jest.fn().mockResolvedValue(coupuresOuvertes) },
    incident: { findUnique: jest.fn().mockResolvedValue(incident), update },
  };
  return { tx: tx as never, update };
}

describe('resoudreIncidentSiPlusDeCoupure', () => {
  const ouverture = new Date('2026-08-25T12:30:00Z');

  it('rétablissement ANTÉRIEUR à l’ouverture : résolution bornée, durée 0 (plus de 500)', async () => {
    const { tx, update } = fauxTx({ statut: 'OUVERT', dateOuverture: ouverture, dateIntervention: null, actionCorrective: null });
    const resolu = await resoudreIncidentSiPlusDeCoupure(tx, 'inc1', new Date('2026-08-25T12:07:00Z'));
    expect(resolu).toBe(true);
    const data = update.mock.calls[0][0].data;
    expect(data.dateResolution).toEqual(ouverture);
    expect(data.dureeCoupureMinutes).toBe(0);
    expect(data.actionCorrective).toContain('Rétablissement constaté par le NOC');
  });

  it('rétablissement postérieur : dates réelles conservées', async () => {
    const { tx, update } = fauxTx({ statut: 'EN_COURS', dateOuverture: ouverture, dateIntervention: new Date(), actionCorrective: 'GE redémarré' });
    const fin = new Date('2026-08-25T13:15:00Z');
    await resoudreIncidentSiPlusDeCoupure(tx, 'inc1', fin);
    const data = update.mock.calls[0][0].data;
    expect(data.dateResolution).toEqual(fin);
    expect(data.dureeCoupureMinutes).toBe(45);
    expect(data.actionCorrective).toBeUndefined(); // intervention réelle : on ne l'écrase pas
  });

  it('des coupures encore ouvertes : incident laissé tel quel', async () => {
    const { tx, update } = fauxTx({ statut: 'OUVERT', dateOuverture: ouverture, dateIntervention: null, actionCorrective: null }, 2);
    const resolu = await resoudreIncidentSiPlusDeCoupure(tx, 'inc1', new Date());
    expect(resolu).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});
