import { detectFuelAnomalies } from './fuelAnomaly.service';
import { prisma } from '../config/database';

jest.mock('../config/database', () => ({
  prisma: { depotage: { findMany: jest.fn() } },
}));
jest.mock('./settings.service', () => ({
  getNum: (key: string, def: number) =>
    ({ 'ge.prixLitreFCFA': 750, 'carburant.seuilAnomalieLitres': 20 } as Record<string, number>)[key] ?? def,
}));

const mockDepotages = (rows: unknown[]) =>
  (prisma.depotage.findMany as jest.Mock).mockResolvedValue(rows);

const site = { code: 'MAR1', nom: 'Site 1', region: 'Maritime' };

describe('detectFuelAnomalies', () => {
  it('site sain (écarts sous le plancher) → score 0', async () => {
    mockDepotages([
      { siteId: 's1', volumeLitres: 1000, ecartConsoLitres: 5, ecartLivraisonLitres: -3, site },
      { siteId: 's1', volumeLitres: 1000, ecartConsoLitres: -10, ecartLivraisonLitres: 2, site },
      { siteId: 's1', volumeLitres: 1000, ecartConsoLitres: 0, ecartLivraisonLitres: 0, site },
    ]);
    const [r] = await detectFuelAnomalies();
    expect(r.score).toBe(0);
    expect(r.niveau).toBe('OK');
    expect(r.perteTotaleLitres).toBe(0);
  });

  it('surconsommation récurrente + manquant livraison → score élevé et pertes chiffrées', async () => {
    mockDepotages([
      { siteId: 's1', volumeLitres: 1000, ecartConsoLitres: 300, ecartLivraisonLitres: -200, site },
      { siteId: 's1', volumeLitres: 1000, ecartConsoLitres: 250, ecartLivraisonLitres: -150, site },
      { siteId: 's1', volumeLitres: 1000, ecartConsoLitres: 200, ecartLivraisonLitres: 0, site },
    ]);
    const [r] = await detectFuelAnomalies();
    // pertes : surconso 300+250+200=750 ; livraison 200+150=350 → 1100 L
    expect(r.perteSurconsoLitres).toBe(750);
    expect(r.perteLivraisonLitres).toBe(350);
    expect(r.perteTotaleLitres).toBe(1100);
    expect(r.perteFCFA).toBe(1100 * 750);
    expect(r.nbAnomalies).toBe(3);
    expect(r.score).toBeGreaterThanOrEqual(35); // au moins « suspect »
    expect(['SUSPECT', 'CRITIQUE']).toContain(r.niveau);
    expect(r.facteurs.length).toBeGreaterThan(0);
  });

  it('un seul dépotage anormal → score atténué (pas une tendance)', async () => {
    mockDepotages([
      { siteId: 's1', volumeLitres: 1000, ecartConsoLitres: 500, ecartLivraisonLitres: 0, site },
    ]);
    const [r] = await detectFuelAnomalies();
    // fiabilité = 1/3 → score divisé par 3 vs une vraie tendance
    expect(r.score).toBeLessThan(35);
  });

  it('tri par score décroissant', async () => {
    mockDepotages([
      { siteId: 's1', volumeLitres: 1000, ecartConsoLitres: 50, ecartLivraisonLitres: 0, site: { ...site, code: 'A' } },
      { siteId: 's1', volumeLitres: 1000, ecartConsoLitres: 50, ecartLivraisonLitres: 0, site: { ...site, code: 'A' } },
      { siteId: 's1', volumeLitres: 1000, ecartConsoLitres: 50, ecartLivraisonLitres: 0, site: { ...site, code: 'A' } },
      { siteId: 's2', volumeLitres: 1000, ecartConsoLitres: 400, ecartLivraisonLitres: -300, site: { ...site, code: 'B' } },
      { siteId: 's2', volumeLitres: 1000, ecartConsoLitres: 400, ecartLivraisonLitres: -300, site: { ...site, code: 'B' } },
      { siteId: 's2', volumeLitres: 1000, ecartConsoLitres: 400, ecartLivraisonLitres: -300, site: { ...site, code: 'B' } },
    ]);
    const res = await detectFuelAnomalies();
    expect(res[0].code).toBe('B'); // le plus suspect en tête
    expect(res[0].score).toBeGreaterThanOrEqual(res[1].score);
  });
});
