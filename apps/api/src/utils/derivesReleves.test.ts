import { consoKwh, heuresMarche, consoGasoil } from './derivesReleves';

/**
 * Les rapports ADDITIONNENT ces colonnes. Elles doivent donc être exactes, et
 * `null` (inconnu) ne doit jamais se confondre avec 0 (rien consommé).
 */
describe('valeurs dérivées d’un relevé', () => {
  it('consommation CEET : différence des index', () => {
    expect(consoKwh(1000, 1450)).toBe(450);
    expect(consoKwh(1000, 1000)).toBe(0);
  });

  it('un index qui recule ne donne pas une consommation négative', () => {
    expect(consoKwh(1000, 900)).toBe(0);          // compteur remplacé, par exemple
    expect(heuresMarche(500, 490)).toBe(0);
  });

  it('heures de marche : différence des index horaires', () => {
    expect(heuresMarche(1200.5, 1260)).toBeCloseTo(59.5);
  });

  it('gasoil consommé : ce qu’il y avait, plus les livraisons, moins ce qui reste', () => {
    expect(consoGasoil(800, 0, 650)).toBe(150);
    expect(consoGasoil(300, 1000, 900)).toBe(400);   // une livraison de 1000 L entre les deux
  });

  it('une jauge qui monte sans livraison connue vaut zéro, pas un négatif', () => {
    expect(consoGasoil(300, 0, 900)).toBe(0);
  });

  // Inconnu n'est pas zéro : un total de consommation ne doit pas se compléter
  // d'un faux 0 quand une mesure manque.
  it('renvoie null dès qu’une mesure manque', () => {
    expect(consoKwh(null, 1450)).toBeNull();
    expect(consoKwh(1000, undefined)).toBeNull();
    expect(heuresMarche(null, null)).toBeNull();
    expect(consoGasoil(null, 0, 500)).toBeNull();
    expect(consoGasoil(800, 0, null)).toBeNull();
    expect(consoKwh(NaN, 5)).toBeNull();
  });
});
