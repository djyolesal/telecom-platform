import { bilanCarburant } from './bilanCarburant.service';
import { prisma } from '../config/database';
import { chargerSeries } from './stocksMensuels.service';

/**
 * Périmètre du bilan : un site sans groupe électrogène ni cuve n'a pas de stock,
 * il n'a donc rien à faire dans « sites mesurés : N / total ». Mais un site que
 * son statut dit « sans GE » et qui a pourtant reçu du carburant reste visible :
 * l'écarter retirerait du gasoil des totaux.
 */

jest.mock('../config/database', () => ({
  prisma: {
    site: { findMany: jest.fn() },
    releveEnergie: { findMany: jest.fn().mockResolvedValue([]) },
    depotage: { findMany: jest.fn().mockResolvedValue([]) },
    mouvementCarburant: { findMany: jest.fn().mockResolvedValue([]) },
  },
}));
jest.mock('../utils/memo', () => ({ memo: (_k: string, _t: number, fn: () => unknown) => fn() }));
jest.mock('./settings.service', () => ({
  geParams: () => ({ facteurChargePermanent: 0.7, facteurChargeSecours: 0.5, consoSpecificDieselLKwh: 0.28, prixLitreFCFA: 850, heuresParMoisPermanent: 720, heuresParMoisSecours: 50 }),
  getNum: (_k: string, d: number) => d,
}));
jest.mock('./mouvementsCarburant.service', () => ({ signeMouvement: () => 1 }));
jest.mock('./stocksMensuels.service', () => ({
  ...jest.requireActual('./stocksMensuels.service'),
  chargerSeries: jest.fn(),
}));

const p = prisma as unknown as { site: { findMany: jest.Mock } };
const series = chargerSeries as jest.Mock;

const site = (code: string, statutGE: string, cuve: number | null) => ({
  id: code, code, nom: `Site ${code}`, region: 'Maritime', statutGE, puissanceGEkva: 0, cuveVolumeLitres: cuve, groupes: [],
});
const LIVRAISON = { date: new Date('2026-09-12T10:00:00Z'), litres: 500 };

beforeEach(() => {
  jest.clearAllMocks();
  p.site.findMany.mockResolvedValue([
    site('A', 'GE_SECOURS', 2000),     // groupe + cuve
    site('B', 'PAS_DE_GE', null),      // ni groupe ni cuve, aucune donnée : hors bilan
    site('C', 'PAS_DE_GE', 2000),      // cuve seule : reste
    site('D', 'PAS_DE_GE', null),      // « sans GE » mais a reçu du gasoil : reste
    site('E', 'PAS_DE_GE', 0),         // cuve à zéro, aucune donnée : hors bilan
  ]);
  series.mockResolvedValue(new Map([
    ['D', { releves: [], livraisons: [LIVRAISON], mouvements: [] }],
  ]));
});

// Période libre : ne dépend pas du moteur mensuel, seulement du périmètre.
const bilan = () => bilanCarburant(new Date('2026-09-05T00:00:00Z'), new Date('2026-09-25T00:00:00Z'));

describe('bilan carburant : périmètre des sites', () => {
  it('écarte les sites sans groupe, sans cuve et sans donnée', async () => {
    const b = await bilan();
    expect(b.lignes.map((l) => l.code).sort()).toEqual(['A', 'C', 'D']);
    expect(b.totaux.nbSites).toBe(3);
    expect(b.totaux.nbSitesHorsPerimetre).toBe(2);
  });

  it('garde un site sans GE qui a reçu du carburant : il ne disparaît pas des totaux', async () => {
    const b = await bilan();
    expect(b.lignes.find((l) => l.code === 'D')).toBeDefined();
  });

  it('garde une cuve sans groupe', async () => {
    const b = await bilan();
    expect(b.lignes.find((l) => l.code === 'C')).toBeDefined();
  });

  it('le dénominateur de la courbe suit le périmètre', async () => {
    const b = await bilan();
    for (const point of b.courbe) expect(point.nbSites).toBe(3);
  });

  it('tout le parc concerné : rien n’est écarté', async () => {
    p.site.findMany.mockResolvedValue([site('A', 'GE_SECOURS', 2000), site('C', 'PAS_DE_GE', 2000)]);
    series.mockResolvedValue(new Map());
    const b = await bilan();
    expect(b.totaux.nbSites).toBe(2);
    expect(b.totaux.nbSitesHorsPerimetre).toBe(0);
  });

  it('charge les séries de TOUS les sites avant de décider (la décision se prend sur les données)', async () => {
    await bilan();
    expect(series.mock.calls[0][0].sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
  });
});

describe('bilan carburant : le livré est le livré réel', () => {
  // Sur un mois entier (méthode bilan matière), un site sans relevé de cuve
  // n'a pas de bilan mensuel. Son livré était compté pour ZÉRO : le total de la
  // page perdait le gasoil livré aux sites non relevés.
  const septembre = () => bilanCarburant(new Date('2026-09-01T00:00:00Z'), new Date('2026-09-30T00:00:00Z'));

  it('compte la livraison d’un site non mesuré dans sa ligne et dans le total', async () => {
    const b = await septembre();
    expect(b.methode).toBe('BILAN_MATIERE');
    const d = b.lignes.find((l) => l.code === 'D')!;
    expect(d.mesure).toBe(false);
    expect(d.livre).toBe(500);
    expect(b.totaux.livreLitres).toBe(500);
  });

  it('donne à part le livré des sites relevés (celui du rapport mensuel)', async () => {
    const b = await septembre();
    // D n'a aucun relevé en septembre : absent du rapport mensuel, donc de cette part.
    expect(b.totaux.livreSitesRelevesLitres).toBe(0);
    expect(b.lignes.find((l) => l.code === 'D')!.livreReleve).toBe(0);
  });

  it('la courbe compte la même livraison dans son mois', async () => {
    const b = await septembre();
    const sept = b.courbe.find((c) => c.annee === 2026 && c.mois === 9)!;
    expect(sept.livre).toBe(500);
    expect(sept.nbSitesMesures).toBe(0);
    const aout = b.courbe.find((c) => c.annee === 2026 && c.mois === 8)!;
    expect(aout.livre).toBe(0);
  });

  it('une livraison au 1er du mois à minuit appartient au mois précédent (même fenêtre que le moteur)', async () => {
    series.mockResolvedValue(new Map([
      ['D', { releves: [], livraisons: [{ date: new Date('2026-09-01T00:00:00Z'), litres: 300 }], mouvements: [] }],
    ]));
    const b = await septembre();
    expect(b.totaux.livreLitres).toBe(0);
    expect(b.courbe.find((c) => c.mois === 8)!.livre).toBe(300);
  });

  it('les transferts et purges d’un site non mesuré comptent aussi', async () => {
    series.mockResolvedValue(new Map([
      ['D', { releves: [], livraisons: [], mouvements: [{ date: new Date('2026-09-15T00:00:00Z'), litres: -120 }] }],
    ]));
    const b = await septembre();
    expect(b.lignes.find((l) => l.code === 'D')!.mouvements).toBe(-120);
  });
});
