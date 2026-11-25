import { prisma } from '../config/database';
import { exigerSitesACuve } from './planLivraison.service';

/** Un plan ne reçoit que des sites à cuve ; ceux déjà au plan restent modifiables. */
jest.mock('../config/database', () => ({ prisma: { site: { findMany: jest.fn() } } }));

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
