import { verdictPertes } from './verdictPertes.service';
import { prisma } from '../config/database';

jest.mock('../config/database', () => ({
  prisma: {
    site: { findMany: jest.fn() },
    depotage: { findMany: jest.fn() },
    releveEnergie: { findMany: jest.fn() },
    mouvementCarburant: { findMany: jest.fn() },
    anomalieSaisie: { groupBy: jest.fn() },
  },
}));
jest.mock('./settings.service', () => ({
  getNum: (key: string, def: number) =>
    ({ 'ge.prixLitreFCFA': 750, 'carburant.seuilAnomalieLitres': 20 } as Record<string, number>)[key] ?? def,
}));

const site = { id: 's1', code: 'MAR1', nom: 'Site 1', region: 'Maritime' };

/** Le mois plein qui précède aujourd'hui : c'est celui que la fenêtre couvre. */
function moisPrecedent() {
  const d = new Date();
  const p = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  return { annee: p.getUTCFullYear(), mois: p.getUTCMonth() + 1 };
}
const jour = (j: number) => {
  const { annee, mois } = moisPrecedent();
  return new Date(Date.UTC(annee, mois - 1, j));
};

function poser(opts: {
  depotages?: unknown[];
  releves?: unknown[];
  anomalies?: unknown[];
}) {
  (prisma.site.findMany as jest.Mock).mockResolvedValue([site]);
  (prisma.depotage.findMany as jest.Mock).mockResolvedValue(opts.depotages ?? []);
  (prisma.releveEnergie.findMany as jest.Mock).mockResolvedValue(opts.releves ?? []);
  (prisma.mouvementCarburant.findMany as jest.Mock).mockResolvedValue([]);
  (prisma.anomalieSaisie.groupBy as jest.Mock).mockResolvedValue(opts.anomalies ?? []);
}

/** Relevés d'un site qui a manifestement perdu du gasoil : 1000 L partis pour
 *  50 h de marche, alors que son débit habituel est de 2 L/h. */
const RELEVES_VOL = () => {
  const { annee, mois } = moisPrecedent();
  const avant = (m: number, j: number, vol: number, idx: number) => ({
    siteId: 's1', dateReleve: new Date(Date.UTC(annee, mois - 1 - m, j)),
    volumeGasoilLitres: vol, indexHeuresGE: idx, groupeId: null,
  });
  return [
    avant(4, 1, 2000, 0), avant(3, 1, 1900, 50), avant(2, 1, 1800, 100), avant(1, 1, 1700, 150),
    { siteId: 's1', dateReleve: jour(28), volumeGasoilLitres: 700, indexHeuresGE: 200, groupeId: null },
  ];
};

describe('verdictPertes - un seul verdict, une hiérarchie déclarée', () => {
  beforeEach(() => jest.clearAllMocks());

  it('le bilan matière tranche quand il est calculable', async () => {
    poser({ releves: RELEVES_VOL() });
    const [v] = await verdictPertes({ jours: 60 });
    expect(v.origine).toBe('BILAN_MATIERE');
    expect(v.litresNonExpliques).toBeGreaterThan(200);
    expect(v.facteurs.join()).toContain('Bilan matière');
  });

  it('à défaut de bilan matière, les écarts aux dépotages prennent le relais', async () => {
    // Aucun relevé de cuve : la méthode validée ne peut rien calculer.
    poser({
      depotages: [
        { siteId: 's1', volumeLitres: 1000, ecartConsoLitres: 300, ecartLivraisonLitres: 0, site },
        { siteId: 's1', volumeLitres: 1000, ecartConsoLitres: 250, ecartLivraisonLitres: 0, site },
        { siteId: 's1', volumeLitres: 1000, ecartConsoLitres: 0, ecartLivraisonLitres: -200, site },
      ],
    });
    const [v] = await verdictPertes({ jours: 60 });
    expect(v.origine).toBe('DEPOTAGES');
    expect(v.litresNonExpliques).toBe(750);
    expect(v.facteurs.join()).toContain('Pas de bilan matière calculable');
  });

  it("une saisie non vérifiée suspend le verdict, quel que soit le chiffre", async () => {
    // RÈGLE QUI PRIME : on n'accuse pas sur une mesure dont on sait déjà
    // qu'elle est douteuse. Le site sort « à fiabiliser », pas « critique ».
    poser({
      releves: RELEVES_VOL(),
      anomalies: [{ siteId: 's1', code: 'CUVE_DEPASSEE', _count: { _all: 2 } }],
    });
    const [v] = await verdictPertes({ jours: 60 });
    expect(v.niveau).toBe('A_FIABILISER');
    expect(v.saisiesSignalees).toBe(2);
    expect(v.facteurs[0]).toContain('attendent vérification');
  });

  it('un site sans écart ne figure pas dans la liste', async () => {
    poser({
      depotages: [{ siteId: 's1', volumeLitres: 1000, ecartConsoLitres: 5, ecartLivraisonLitres: -3, site }],
    });
    expect(await verdictPertes({ jours: 60 })).toEqual([]);
  });

  it('deux méthodes concordantes pèsent plus lourd qu’une seule', async () => {
    poser({
      releves: RELEVES_VOL(),
      depotages: [
        { siteId: 's1', volumeLitres: 1000, ecartConsoLitres: 300, ecartLivraisonLitres: 0, site },
        { siteId: 's1', volumeLitres: 1000, ecartConsoLitres: 250, ecartLivraisonLitres: 0, site },
        { siteId: 's1', volumeLitres: 1000, ecartConsoLitres: 220, ecartLivraisonLitres: 0, site },
      ],
    });
    const [v] = await verdictPertes({ jours: 60 });
    expect(v.origine).toBe('BILAN_MATIERE');
    expect(v.facteurs.join()).toContain('Deux méthodes indépendantes concordent');
    expect(v.niveau).toBe('CRITIQUE');
  });
});
