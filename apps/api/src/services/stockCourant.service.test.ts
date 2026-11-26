import { stockDepuisMesure } from './stockCourant.service';

/**
 * Stock courant d'un site : la mesure de départ est la plus récente entre le
 * dernier relevé et la jauge APRÈS livraison d'un dépotage crédible.
 */

jest.mock('../config/database', () => ({ prisma: {} }));

const j = (jour: number) => new Date(Date.UTC(2026, 10, jour, 10));
const releve = (jour: number, litres: number) => ({ date: j(jour), litres });
const depot = (jour: number, litres: number, avant: number | null = null, apres: number | null = null) =>
  ({ date: j(jour), litres, avant, apres });

describe('stockDepuisMesure', () => {
  it('jauge après livraison crédible : elle remplace relevé + volume (la conso entre les deux n’est plus oubliée)', () => {
    // Relevé 1 200 L le 1er, le site brûle 600 L, livraison de 3 000 L le 10 : 600 → 3 600.
    const r = stockDepuisMesure(releve(1, 1200), [depot(10, 3000, 600, 3600)]);
    expect(r).toEqual({ litres: 3600, reference: j(10), dernierEvenement: j(10), mesure: true });
  });

  it('sans jauge (ou jauge incohérente avec le volume) : relevé + volume, comme avant', () => {
    expect(stockDepuisMesure(releve(1, 1200), [depot(10, 3000)])?.litres).toBe(4200);
    // après − avant = 2 000 pour 3 000 livrés : jauge écartée.
    expect(stockDepuisMesure(releve(1, 1200), [depot(10, 3000, 600, 2600)])?.litres).toBe(4200);
    // après < avant, ou au-delà du plausible : écartée aussi.
    expect(stockDepuisMesure(releve(1, 1200), [depot(10, 3000, 3600, 600)])?.litres).toBe(4200);
    expect(stockDepuisMesure(releve(1, 1200), [depot(10, 3000, 6000, 9000)])?.litres).toBe(4200);
  });

  it('tolérance de 50 L entre (après − avant) et le volume livré', () => {
    expect(stockDepuisMesure(releve(1, 1200), [depot(10, 3000, 600, 3650)])?.litres).toBe(3650);
    expect(stockDepuisMesure(releve(1, 1200), [depot(10, 3000, 600, 3651)])?.litres).toBe(4200);
  });

  it('un relevé postérieur à la jauge reprend la main ; à la même heure, le relevé prime', () => {
    expect(stockDepuisMesure(releve(15, 2500), [depot(10, 3000, 600, 3600)])?.litres).toBe(2500);
    const memeHeure = stockDepuisMesure(releve(10, 3500), [depot(10, 3000, 600, 3600)]);
    expect(memeHeure?.litres).toBe(3500);
  });

  it('les livraisons après la jauge s’ajoutent ; la date publiée est le dernier événement', () => {
    const r = stockDepuisMesure(releve(1, 1200), [depot(20, 1000), depot(10, 3000, 600, 3600)]);
    expect(r).toEqual({ litres: 4600, reference: j(10), dernierEvenement: j(20), mesure: true });
  });

  it('site jamais relevé : jauge crédible si elle existe, sinon somme des livraisons (non mesuré)', () => {
    expect(stockDepuisMesure(null, [depot(5, 2000), depot(10, 3000, 1500, 4500)]))
      .toEqual({ litres: 4500, reference: j(10), dernierEvenement: j(10), mesure: true });
    expect(stockDepuisMesure(null, [depot(10, 3000), depot(5, 2000)]))
      .toEqual({ litres: 5000, reference: j(5), dernierEvenement: j(10), mesure: false });
  });

  it('ni relevé ni livraison : stock inconnu (null), pas 0', () => {
    expect(stockDepuisMesure(null, [])).toBeNull();
  });

  it('un relevé à 0 L reste une mesure (cuve vide réelle)', () => {
    expect(stockDepuisMesure(releve(1, 0), [])).toEqual({ litres: 0, reference: j(1), dernierEvenement: j(1), mesure: true });
  });
});
