import { essaisDuSite, resumer, METHODES } from './precisionStocks.service';
import { bilanMensuelSite, niveauxFrontieres, JaugeDepotageLite, ReleveStockLite, SerieCarburant } from './stocksMensuels.service';

const d = (iso: string) => new Date(iso);
const rel = (date: string, volume: number): ReleveStockLite => ({ date: d(date), volume, index: null, groupeId: null });
const jauge = (date: string, litres: number, avant: number | null, apres: number | null): JaugeDepotageLite => ({ date: d(date), litres, avant, apres });

describe('jauges de dépotage aux frontières de mois', () => {
  // 10 L/j puis, à partir du 25/07, 40 L/j : un relevé par mois ne le voit pas.
  const releves = [rel('2026-06-10T00:00:00Z', 1000), rel('2026-07-10T00:00:00Z', 700), rel('2026-08-20T00:00:00Z', 510)];
  const livraisons = [{ date: d('2026-07-30T10:00:00Z'), litres: 1000 }];
  const jauges = [jauge('2026-07-30T10:00:00Z', 1000, 340, 1340)];
  const base = { releves, livraisons, annee: 2026 };

  it('la fin du mois part de la jauge d\'après livraison, toute proche', () => {
    const b = bilanMensuelSite({ ...base, jauges, mois: 7 })!;
    const ms = d('2026-08-20T00:00:00Z').getTime() - d('2026-07-30T10:00:00Z').getTime();
    const jusquau1er = d('2026-08-01T00:00:00Z').getTime() - d('2026-07-30T10:00:00Z').getTime();
    expect(b.stockFin).toBe(Math.round(1340 - (1340 - 510) * (jusquau1er / ms)));
    expect(b.stockFin).not.toBe(bilanMensuelSite({ ...base, mois: 7 })!.stockFin);
  });

  it('la livraison n\'est comptée qu\'une fois et le mois boucle', () => {
    const b = bilanMensuelSite({ ...base, jauges, mois: 7 })!;
    expect(b.livraisons).toBe(1000);
    expect(b.stockDebut + b.livraisons - b.stockFin).toBe(b.conso);
  });

  it('la fin de M reste le début de M+1', () => {
    expect(bilanMensuelSite({ ...base, jauges, mois: 7 })!.stockFin).toBe(bilanMensuelSite({ ...base, jauges, mois: 8 })!.stockDebut);
  });

  it('un dépotage après la fin du mois le rend définitif', () => {
    const r = [rel('2026-06-10T00:00:00Z', 1000), rel('2026-07-10T00:00:00Z', 700)];
    const l = [{ date: d('2026-08-05T10:00:00Z'), litres: 500 }];
    expect(bilanMensuelSite({ releves: r, livraisons: l, annee: 2026, mois: 7 })!.provisoire).toBe(true);
    const b = bilanMensuelSite({ releves: r, livraisons: l, jauges: [jauge('2026-08-05T10:00:00Z', 500, 440, 940)], annee: 2026, mois: 7 })!;
    expect(b.provisoire).toBe(false);
  });

  it('rythme H1, débit et contre-épreuve ne bougent pas', () => {
    const avec = bilanMensuelSite({ ...base, jauges, mois: 8 })!;
    const sans = bilanMensuelSite({ ...base, mois: 8 })!;
    expect([avec.consoFenetre, avec.debitLh, avec.gasoilInexplique, avec.fenetreJours])
      .toEqual([sans.consoFenetre, sans.debitLh, sans.gasoilInexplique, sans.fenetreJours]);
  });

  it.each([
    ['jauge manquante', jauge('2026-07-30T10:00:00Z', 1000, null, 1340)],
    ['après inférieur à avant', jauge('2026-07-30T10:00:00Z', 0, 1340, 340)],
    ['écart différent du volume livré', jauge('2026-07-30T10:00:00Z', 1000, 340, 800)],
    ['niveau aberrant', jauge('2026-07-30T10:00:00Z', 1000, 8000, 9000)],
  ])('écarte une jauge douteuse : %s', (_n, j) => {
    expect(niveauxFrontieres(releves, [j])).toHaveLength(releves.length);
  });

  it('à la même heure, le relevé prime sur la jauge de dépotage', () => {
    const pts = niveauxFrontieres([rel('2026-07-30T10:00:00Z', 1300)], jauges);
    expect(pts.map((x) => x.volume)).toEqual([340, 1300]);
  });
});

describe('mesure de précision', () => {
  const J = 86_400_000;
  const t0 = Date.UTC(2026, 5, 1, 8);
  const lineaire = (jours: number[]): SerieCarburant => ({
    releves: jours.map((j) => ({ date: new Date(t0 + j * J), volume: 3000 - 10 * j, index: null, groupeId: null })),
    livraisons: [], mouvements: [],
  });
  const large: [Date, Date] = [new Date(Date.UTC(2026, 0, 1)), new Date(Date.UTC(2027, 0, 1))];

  it('conso régulière : toutes les méthodes retrouvent la jauge cachée', () => {
    const essais = essaisDuSite(lineaire([0, 20, 40, 60, 80]), ...large);
    expect(essais.map((e) => e.vrai)).toEqual([2800, 2600, 2400]); // les extrêmes n'ont pas de voisin
    const suivants = essais.slice(1); // le 1er n'a qu'un point avant : pas de rythme connu
    for (const m of METHODES) for (const e of suivants) expect(e.estime[m]).toBeCloseTo(e.vrai, 5);
  });

  it('la jauge cachée n\'influence pas l\'estimation', () => {
    const s = lineaire([0, 20, 40, 60, 80]);
    s.releves[2] = { ...s.releves[2], volume: 100 };
    const e = essaisDuSite(s, ...large).find((x) => x.vrai === 100)!;
    expect(e.estime.ENCADRER).toBeCloseTo(2600, 5);
  });

  it('un dépotage de la même visite (24 h) est caché aussi', () => {
    const s = lineaire([0, 20, 40, 60, 80]);
    s.jauges = [jauge(new Date(t0 + 40 * J + 3_600_000).toISOString(), 0, 1234, 1234)];
    const e = essaisDuSite(s, ...large).find((x) => x.vrai === 2600)!;
    expect(e.estime.ENCADRER_JAUGES).toBe(e.estime.ENCADRER);
  });

  it('une jauge de dépotage plus proche améliore l\'estimation', () => {
    // 10 L/j jusqu'au jour 35, puis 0 : sans jauge, l'interpolation le lisse.
    const niveaux: Array<[number, number]> = [[0, 1000], [20, 800], [40, 650], [60, 650], [80, 650]];
    const s: SerieCarburant = {
      releves: niveaux.map(([j, v]) => ({ date: new Date(t0 + j * J), volume: v, index: null, groupeId: null })),
      livraisons: [], mouvements: [],
      jauges: [jauge(new Date(t0 + 37 * J).toISOString(), 0, 650, 650)],
    };
    const e = essaisDuSite(s, ...large).find((x) => x.date.getTime() === t0 + 40 * J)!;
    expect(Math.abs(e.estime.ENCADRER_JAUGES - e.vrai)).toBeLessThan(Math.abs(e.estime.ENCADRER - e.vrai));
    expect(e.distanceJauges).toBeCloseTo(3, 5);
    expect(e.distanceReleves).toBeCloseTo(20, 5);
  });

  it('une remontée sans livraison est marquée incohérente', () => {
    const s = lineaire([0, 20, 40, 60, 80]);
    s.releves[2] = { ...s.releves[2], volume: 2900 };
    expect(essaisDuSite(s, ...large).find((x) => x.vrai === 2900)!.coherent).toBe(false);
  });

  it('résume médiane, biais et part à 50 L près', () => {
    const e = (err: number) => ({ vrai: 100, estime: { PROLONGER: 0, PROLONGER_JAUGES: 0, ENCADRER: 100 + err, ENCADRER_JAUGES: 0 } }) as never;
    expect(resumer([e(-10), e(20), e(90)], 'ENCADRER')).toMatchObject({ n: 3, mediane: 20, moyenne: 40, biais: 33, sous50: 67 });
    expect(resumer([], 'ENCADRER')).toBeNull();
  });
});
