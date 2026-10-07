import { construireSuivi, lirePeriode, BcLite, BlLite, DepotageLite } from './suiviCommandes.service';

jest.mock('../config/database', () => ({ prisma: {} }));

const site = (id: string) => ({ id, code: `C-${id}`, nom: `Site ${id}`, region: 'Maritime' });
const dep = (id: string, date: string, litres: number, s = 'A'): DepotageLite => ({
  id, reference: `DEP-${id}`, dateDepotage: new Date(date), volumeLitres: litres,
  volumeAnnonceLitres: null, ecartLivraisonLitres: null, stockAvantLitres: null, stockApresLitres: null,
  nomChauffeur: null, technicien: null, site: site(s),
});
const bc = (id: string, trimestre: number, mois: number[], annee = 2026): BcLite => ({
  id, numero: `BC-${id}`, annee, trimestre, statut: 'OUVERT',
  volumesMensuels: mois.map((m) => ({ mois: m, volumePrevuLitres: 1000 })),
});
const bl = (o: Partial<BlLite> & { id: string; bonCommandeId: string; mois: number }): BlLite => ({
  numeroBL: `BL-${o.id}`, annee: 2026, statut: 'LIVRE',
  dateChargement: new Date(Date.UTC(2026, o.mois - 1, 5, 8)), dateTraitement: null, dateCloture: null,
  immatriculation: 'TG 1', volumeChargeLitres: 0,
  resteRetourDepotLitres: null, restePerteLitres: null, resteReportLitres: null,
  transporteur: null, chauffeur: null, reportsRecus: [], lignes: [], ...o,
});
const ligne = (id: string, prevu: number, depots: DepotageLite[], s = 'A') => ({
  id, volumePrevuLitres: prevu, statut: 'LIVRE', pickup: null, site: site(s), depotages: depots,
});

const T3 = lirePeriode('2026-07', '2026-09');

describe('période en mois', () => {
  it('lit AAAA-MM et refuse le reste', () => {
    expect(T3).toEqual({ debut: { annee: 2026, mois: 7 }, fin: { annee: 2026, mois: 9 } });
    expect(() => lirePeriode('2026-09', '2026-07')).toThrow(/précède/);
    expect(() => lirePeriode('juillet', '2026-09')).toThrow(/AAAA-MM/);
    expect(() => lirePeriode('2026-13', '2026-12')).toThrow(/invalide/);
    expect(() => lirePeriode('2024-01', '2026-01')).toThrow(/24 mois/);
  });
});

describe('synthèse par bon de commande', () => {
  const b = bc('T3', 3, [7, 8, 9]);

  it('chargé (avec reports reçus), livré au plan, hors plan, clôture et écart', () => {
    const s = construireSuivi(T3, [b], [
      bl({
        id: '1', bonCommandeId: 'T3', mois: 7, volumeChargeLitres: 10000, dateCloture: new Date('2026-07-20'),
        reportsRecus: [{ resteReportLitres: 500 }],
        resteRetourDepotLitres: 300, restePerteLitres: 50, resteReportLitres: 150,
        lignes: [ligne('l1', 6000, [dep('d1', '2026-07-06T10:00:00Z', 5800)]), ligne('l2', 4000, [dep('d2', '2026-07-07T10:00:00Z', 3000, 'B')], 'B')],
      }),
    ], [dep('h1', '2026-07-15T10:00:00Z', 1000, 'C')], new Map());
    const x = s.syntheses[0];
    expect(x).toMatchObject({ commande: 3000, charge: 10500, planifie: 10000, livrePlan: 8800, livreHorsPlan: 1000, retourDepot: 300, perte: 50, report: 150 });
    // 10 500 − 8 800 − 1 000 − 300 − 50 − 150
    expect(x.ecartNonExplique).toBe(200);
    expect(x.couverture).toBe('Commande entière');
  });

  // L'avoir porte sur la commande entière : le déduire d'un seul mois fausserait l'écart.
  it('déduit l’avoir sur la commande entière seulement', () => {
    const bls = [bl({ id: '1', bonCommandeId: 'T3', mois: 8, volumeChargeLitres: 5000 })];
    const entier = construireSuivi(T3, [b], bls, [], new Map([['T3', 400]]));
    expect(entier.syntheses[0]).toMatchObject({ avoirs: 400, ecartNonExplique: 4600 });
    const partiel = construireSuivi(lirePeriode('2026-08', '2026-09'), [b], bls, [], new Map([['T3', 400]]));
    expect(partiel.syntheses[0]).toMatchObject({ avoirs: 0, ecartNonExplique: 5000, couverture: 'Partielle (2/3 mois)', commande: 2000 });
  });

  it('un BC sans chargement dans la période figure quand même (commandé)', () => {
    const s = construireSuivi(T3, [b], [], [], new Map());
    expect(s.syntheses[0]).toMatchObject({ commande: 3000, charge: 0, nbBl: 0 });
  });

  it('les chargements hors période ne comptent pas', () => {
    const s = construireSuivi(lirePeriode('2026-07', '2026-07'), [b], [
      bl({ id: '1', bonCommandeId: 'T3', mois: 7, volumeChargeLitres: 1000 }),
      bl({ id: '2', bonCommandeId: 'T3', mois: 8, volumeChargeLitres: 9000 }),
    ], [], new Map());
    expect(s.syntheses[0].charge).toBe(1000);
    expect(s.bls.map((x) => x.numeroBL)).toEqual(['BL-1']);
  });

  // Même règle d'arrondi que le rapprochement : par mois, puis additionné.
  it('arrondit mois par mois, comme le rapprochement', () => {
    const s = construireSuivi(T3, [b], [
      bl({ id: '1', bonCommandeId: 'T3', mois: 7, lignes: [ligne('a', 0, [dep('x', '2026-07-06T00:00:00Z', 10.4)])] }),
      bl({ id: '2', bonCommandeId: 'T3', mois: 8, lignes: [ligne('b', 0, [dep('y', '2026-08-06T00:00:00Z', 10.4)])] }),
    ], [], new Map());
    expect(s.syntheses[0].livrePlan).toBe(20);   // 10 + 10, et non round(20,8) = 21
  });
});

describe('dépotages hors plan', () => {
  it('rattachés au BC qui couvre leur mois', () => {
    const s = construireSuivi(lirePeriode('2026-07', '2026-12'), [bc('T3', 3, [7, 8, 9]), bc('T4', 4, [10, 11, 12])], [],
      [dep('h1', '2026-08-10T00:00:00Z', 100), dep('h2', '2026-10-10T00:00:00Z', 200)], new Map());
    expect(s.syntheses.map((x) => [x.numero, x.livreHorsPlan])).toEqual([['BC-T3', 100], ['BC-T4', 200]]);
    expect(s.depotages.map((d) => [d.reference, d.rattachement, d.bc])).toEqual([
      ['DEP-h1', 'Hors plan', 'BC-T3'], ['DEP-h2', 'Hors plan', 'BC-T4'],
    ]);
  });

  // Deux BC sur le même mois : on ne choisit pas au hasard.
  it('laissés « non rattachés » si aucun BC, ou plusieurs, couvrent le mois', () => {
    const s = construireSuivi(T3, [bc('A', 3, [7, 8, 9]), bc('B', 3, [9])], [],
      [dep('h1', '2026-09-10T00:00:00Z', 100)], new Map());
    expect(s.syntheses.every((x) => x.livreHorsPlan === 0)).toBe(true);
    expect(s.totaux.horsPlanNonRattache).toBe(100);
    expect(s.depotages[0]).toMatchObject({ rattachement: 'Hors plan, non rattaché', bc: '' });
  });

  it('avec un filtre de BC, seuls ses dépotages hors plan restent', () => {
    const s = construireSuivi(lirePeriode('2026-07', '2026-12'), [bc('T3', 3, [7, 8, 9]), bc('T4', 4, [10, 11, 12])], [],
      [dep('h1', '2026-08-10T00:00:00Z', 100), dep('h2', '2026-10-10T00:00:00Z', 200)], new Map(), 'T3');
    expect(s.syntheses.map((x) => x.numero)).toEqual(['BC-T3']);
    expect(s.depotages.map((d) => d.reference)).toEqual(['DEP-h1']);
  });
});

describe('bons de livraison et dépotages', () => {
  it('l’écart d’un BL n’existe qu’une fois le BL clôturé', () => {
    const s = construireSuivi(T3, [bc('T3', 3, [7, 8, 9])], [
      bl({ id: 'ouvert', bonCommandeId: 'T3', mois: 7, volumeChargeLitres: 1000 }),
      bl({ id: 'clos', bonCommandeId: 'T3', mois: 7, volumeChargeLitres: 1000, dateCloture: new Date('2026-07-20'), resteRetourDepotLitres: 1000 }),
    ], [], new Map());
    const par = Object.fromEntries(s.bls.map((x) => [x.numeroBL, x]));
    expect(par['BL-ouvert'].ecartNonExplique).toBeNull();
    expect(par['BL-clos'].ecartNonExplique).toBe(0);
  });

  it('le délai du chargement au dépotage, en jours', () => {
    const s = construireSuivi(T3, [bc('T3', 3, [7, 8, 9])], [
      bl({ id: '1', bonCommandeId: 'T3', mois: 7, dateChargement: new Date('2026-07-05T08:00:00Z'),
        lignes: [ligne('l', 100, [dep('d', '2026-07-06T20:00:00Z', 100)])] }),
    ], [], new Map());
    expect(s.depotages[0]).toMatchObject({ rattachement: 'Au plan', numeroBL: 'BL-1', bc: 'BC-T3', delaiJours: 1.5 });
    expect(s.lignes[0]).toMatchObject({ prevu: 100, livre: 100, ecart: 0, nbDepotages: 1 });
  });
});
