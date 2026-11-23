import { haussesDuMois, haussesSansLivraison, litresManquants } from './livraisonsManquantes.service';
import { JaugeDepotageLite, LivraisonLite, MouvementLite, ReleveStockLite, SerieCarburant } from './stocksMensuels.service';

const d = (j: string) => new Date(j.length === 10 ? `${j}T10:00:00Z` : j);
const rel = (j: string, volume: number): ReleveStockLite => ({ date: d(j), volume, index: null, groupeId: null });
const ev = (j: string, litres: number) => ({ date: d(j), litres });
const serie = (releves: ReleveStockLite[], livraisons: LivraisonLite[] = [], mouvements: MouvementLite[] = [], jauges: JaugeDepotageLite[] = []): SerieCarburant =>
  ({ releves, livraisons, mouvements, jauges });

// Site à 10 L/j : 1000 le 01/08, 900 le 11/08, puis hausse révélée le 21/08.
const AVANT = [rel('2026-08-01', 1000), rel('2026-08-11', 900)];

describe('livraisons manquantes probables', () => {
  it('niveau maintenu ensuite : PROBABLE, volume = hausse + conso de l’intervalle', () => {
    const h = haussesSansLivraison(serie([...AVANT, rel('2026-08-21', 1800), rel('2026-08-31', 1700)]));
    expect(h).toEqual([{ depuis: d('2026-08-11'), date: d('2026-08-21'), litres: 1000, statut: 'PROBABLE' }]);
  });

  it('pas encore de visite suivante : A_CONFIRMER, dès la première visite', () => {
    const h = haussesSansLivraison(serie([...AVANT, rel('2026-08-21', 1800)]));
    expect(h.map((x) => x.statut)).toEqual(['A_CONFIRMER']);
    expect(litresManquants(h)).toBe(1000);
    expect(litresManquants(h, 'PROBABLE')).toBe(0);
  });

  it('un second relevé de la même visite ne confirme rien', () => {
    const h = haussesSansLivraison(serie([...AVANT, rel('2026-08-21', 1800), rel('2026-08-21T11:00:00Z', 1800)]));
    expect(h.map((x) => x.statut)).toEqual(['A_CONFIRMER']);
  });

  it('livraison ou transfert enregistré : rien à signaler', () => {
    const apres = [...AVANT, rel('2026-08-21', 1800), rel('2026-08-31', 1700)];
    expect(haussesSansLivraison(serie(apres, [ev('2026-08-15', 1000)]))).toEqual([]);
    expect(haussesSansLivraison(serie(apres, [], [ev('2026-08-15', 1000)]))).toEqual([]);
  });

  it('livraison saisie quelques heures après la jauge, ou juste avant la précédente : pas manquante', () => {
    const apres = [...AVANT, rel('2026-08-21', 1800), rel('2026-08-31', 1700)];
    expect(haussesSansLivraison(serie(apres, [ev('2026-08-21T18:00:00Z', 1000)]))).toEqual([]);
    expect(haussesSansLivraison(serie(apres, [ev('2026-08-11T06:00:00Z', 1000)]))).toEqual([]);
  });

  it('une AUTRE livraison dans les 24 h n’efface pas une vraie hausse', () => {
    const h = haussesSansLivraison(serie(
      [...AVANT, rel('2026-08-21', 1800), rel('2026-08-22', 2790), rel('2026-08-31', 2700)],
      [ev('2026-08-21T18:00:00Z', 1000)],
    ));
    expect(h.map((x) => [x.litres, x.statut])).toEqual([[1000, 'PROBABLE']]);
  });

  it('hausse qui retombe : jauge à vérifier, hors total', () => {
    const h = haussesSansLivraison(serie([...AVANT, rel('2026-08-21', 1800), rel('2026-08-31', 700)]));
    expect(h.map((x) => x.statut)).toEqual(['SAISIE']);
    expect(litresManquants(h)).toBe(0);
  });

  it('hausse qui suit une chute inexpliquée : jauge à vérifier', () => {
    const h = haussesSansLivraison(serie([...AVANT, rel('2026-08-21', 0), rel('2026-08-31', 700), rel('2026-09-10', 600)]));
    expect(h.map((x) => x.statut)).toEqual(['SAISIE']);
  });

  it('sous 100 L : bruit de mesure', () => {
    expect(haussesSansLivraison(serie([...AVANT, rel('2026-08-21', 999), rel('2026-08-31', 900)]))).toEqual([]);
    expect(haussesSansLivraison(serie([...AVANT, rel('2026-08-21', 1000), rel('2026-08-31', 900)]))).toHaveLength(1);
  });

  it('jauges d’un dépotage enregistré : la livraison explique sa propre hausse', () => {
    expect(haussesSansLivraison(serie(
      [...AVANT, rel('2026-08-21', 1800), rel('2026-08-31', 1700)],
      [ev('2026-08-15', 1000)], [], [{ date: d('2026-08-15'), litres: 1000, avant: 860, apres: 1860 }],
    ))).toEqual([]);
  });

  it('rangée dans le mois de la jauge qui la révèle', () => {
    const s = serie([rel('2026-07-11', 900), rel('2026-07-21', 800), rel('2026-08-03', 1700), rel('2026-08-20', 1500)]);
    expect(haussesDuMois(s, 2026, 7)).toEqual([]);
    expect(haussesDuMois(s, 2026, 8)).toHaveLength(1);
    expect(haussesDuMois(s, 2026, 9)).toEqual([]);
  });

  it('site sans série', () => expect(haussesDuMois(undefined, 2026, 8)).toEqual([]));
});
