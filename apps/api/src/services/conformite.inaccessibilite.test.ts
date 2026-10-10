import { calculerDuParSite } from './conformiteTaches.service';
import { CONTRACTUAL_TASKS } from '../utils/tachesPreventives';
import { prisma } from '../config/database';

/**
 * Site INACCESSIBLE (décision du 10/10/2026) : la tâche reste DUE, mais due et
 * non réalisée sur un mois couvert (au moins 7 jours), elle est JUSTIFIÉE :
 * comptée dans le dû, hors retard, le site reste conforme.
 */

jest.mock('../config/database', () => ({
  prisma: {
    maintenance: { findMany: jest.fn(), groupBy: jest.fn() },
    depotage: { findMany: jest.fn() },
    releveEnergie: { findMany: jest.fn() },
    exclusionContractuelle: { findMany: jest.fn() },
    inaccessibiliteSite: { findMany: jest.fn() },
  },
}));
jest.mock('./settings.service', () => ({
  dateReferenceTaches: jest.fn(() => new Date('2026-01-01T00:00:00.000Z')),
  getNum: jest.fn((_k: string, d: number) => d),
}));

const p = prisma as unknown as Record<string, Record<string, jest.Mock>>;
const desherbage = CONTRACTUAL_TASKS.filter((t) => t.key === 'desherbage');
const SITE = {
  id: 's1', powerConfig: 'CEET_GE', typePylone: 'GREENFIELD', hasClimatiseur: false, hasExtincteurs: false,
  statutGE: 'GE_SECOURS', cuveVolumeLitres: 2000,
};
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

beforeEach(() => {
  jest.clearAllMocks();
  p.maintenance.findMany.mockResolvedValue([]);
  p.maintenance.groupBy.mockResolvedValue([]);
  p.depotage.findMany.mockResolvedValue([]);
  p.releveEnergie.findMany.mockResolvedValue([]);
  p.exclusionContractuelle.findMany.mockResolvedValue([]);
});

async function juin() {
  const r = await calculerDuParSite([SITE], ['2026-06'], '2026-06', desherbage);
  return r.get('s1')!;
}

describe('tâche mensuelle non faite en juin', () => {
  it('sans inaccessibilité : en retard (NOK), site non conforme', async () => {
    p.inaccessibiliteSite.findMany.mockResolvedValue([]);
    const du = await juin();
    expect(du.statuts.desherbage).toBe('NOK');
    expect(du.conforme).toBe(false);
    expect(du.parMois.get('2026-06')).toEqual({ dues: 1, realisees: 0, justifiees: 0 });
  });

  it('site inaccessible 10 jours : JUSTIFIÉE, toujours due, site conforme', async () => {
    p.inaccessibiliteSite.findMany.mockResolvedValue([{ siteId: 's1', debutLe: d('2026-06-05'), finLe: d('2026-06-14') }]);
    const du = await juin();
    expect(du.statuts.desherbage).toBe('JUSTIFIE');
    expect(du.conforme).toBe(true);
    expect(du.parMois.get('2026-06')).toEqual({ dues: 1, realisees: 0, justifiees: 1 });
  });

  it('inaccessible 3 jours seulement (sous le seuil) : reste en retard', async () => {
    p.inaccessibiliteSite.findMany.mockResolvedValue([{ siteId: 's1', debutLe: d('2026-06-05'), finLe: d('2026-06-07') }]);
    expect((await juin()).statuts.desherbage).toBe('NOK');
  });

  it('réalisée malgré la période : OK, rien de justifié', async () => {
    p.inaccessibiliteSite.findMany.mockResolvedValue([{ siteId: 's1', debutLe: d('2026-06-01'), finLe: null }]);
    p.maintenance.findMany.mockResolvedValue([{ siteId: 's1', tachePreventiveKey: 'desherbage', dateFin: d('2026-06-20') }]);
    const du = await juin();
    expect(du.statuts.desherbage).toBe('OK');
    expect(du.parMois.get('2026-06')).toEqual({ dues: 1, realisees: 1, justifiees: 0 });
  });
});
