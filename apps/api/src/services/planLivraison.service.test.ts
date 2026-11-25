import { prisma } from '../config/database';
import { exigerSitesACuve, validatePlan, volumeRecuBl } from './planLivraison.service';

/** Un plan ne reçoit que des sites à cuve ; ceux déjà au plan restent modifiables. */
jest.mock('../config/database', () => ({
  prisma: { site: { findMany: jest.fn() }, volumeMensuel: { findUnique: jest.fn() }, bonLivraison: { aggregate: jest.fn() } },
}));

const CUVES: Record<string, { nom: string; cuve: number | null }> = {
  a: { nom: 'AGOE', cuve: 2000 }, b: { nom: 'BADOU', cuve: null }, c: { nom: 'CINKASSE', cuve: 0 },
};
const findMany = prisma.site.findMany as unknown as jest.Mock;
beforeEach(() => {
  findMany.mockReset().mockImplementation(async ({ where }: { where: { id: { in: string[] }; cuveVolumeLitres?: { gt: number } } }) =>
    where.id.in.filter((id) => CUVES[id] && (!where.cuveVolumeLitres || (CUVES[id].cuve ?? 0) > where.cuveVolumeLitres.gt))
      .map((id) => ({ id, nom: CUVES[id].nom })));
});

describe('sites à cuve du plan de livraison', () => {
  it('accepte un site à cuve', async () => {
    await expect(exigerSitesACuve(['a'])).resolves.toBeUndefined();
  });
  it('refuse une cuve absente ou à 0, en nommant les sites', async () => {
    await expect(exigerSitesACuve(['a', 'b', 'c'])).rejects.toMatchObject({
      statusCode: 422, message: expect.stringContaining('BADOU, CINKASSE'),
    });
    await expect(exigerSitesACuve(['a', 'b'])).rejects.toMatchObject({ message: expect.not.stringContaining('AGOE') });
  });
  it('un site déjà au plan reste modifiable, un nouveau non', async () => {
    await expect(exigerSitesACuve(['a', 'b'], ['b'])).resolves.toBeUndefined();
    await expect(exigerSitesACuve(['b', 'c'], ['b'])).rejects.toMatchObject({ message: expect.stringContaining('CINKASSE') });
  });
  it('plan vide ou inchangé : aucune lecture', async () => {
    await exigerSitesACuve([]);
    await exigerSitesACuve(['b'], ['b']);
    expect(findMany).not.toHaveBeenCalled();
  });
  it('site inconnu refusé', async () => {
    await expect(exigerSitesACuve(['zzz'])).rejects.toMatchObject({ statusCode: 422 });
  });
});

/**
 * Camion qui reprend le reste d'un autre : le plan se mesure au volume À BORD
 * (chargé + reçu), le dépassement mensuel du BC au seul volume CHARGÉ - le reste
 * reçu y est déjà compté par le chargement d'origine.
 */
describe('plan d’un camion qui reprend un reste', () => {
  const agregat = prisma.bonLivraison.aggregate as unknown as jest.Mock;
  const valider = (total: number, recu: number, prevuMois: number) => {
    (prisma.volumeMensuel.findUnique as unknown as jest.Mock).mockResolvedValue({ volumePrevuLitres: prevuMois });
    agregat.mockResolvedValue({ _sum: { volumeChargeLitres: 0 } });
    return validatePlan('bc1', 10, 10000, [{ volumePrevuLitres: total }], 'bl1', recu);
  };

  it('accepte chargé + reçu, sans faux dépassement mensuel', async () => {
    expect((await valider(12000, 2000, 10000)).warnings).toEqual([]);
  });
  it('refuse le seul volume chargé, en détaillant ce qui est à bord', async () => {
    await expect(valider(10000, 2000, 10000)).rejects.toMatchObject({
      statusCode: 400, message: expect.stringContaining('12000 L : 10000 L chargés + 2000 L reçus'),
    });
  });
  it('sans reste reçu : règle inchangée', async () => {
    expect((await valider(10000, 0, 10000)).warnings).toEqual([]);
    await expect(valider(12000, 0, 10000)).rejects.toMatchObject({ statusCode: 400 });
  });
  it('un vrai dépassement mensuel reste signalé', async () => {
    expect((await valider(10000, 0, 9000)).warnings.join()).toContain('Dépassement du volume mensuel');
  });
  it('reste reçu : somme des reports pointant sur ce chargement', async () => {
    agregat.mockResolvedValue({ _sum: { resteReportLitres: '1500.50' } });
    expect(await volumeRecuBl('bl1')).toBe(1500.5);
    expect(agregat).toHaveBeenLastCalledWith(expect.objectContaining({ where: { reportSurBlId: 'bl1' } }));
    agregat.mockResolvedValue({ _sum: { resteReportLitres: null } });
    expect(await volumeRecuBl('bl1')).toBe(0);
  });
});
