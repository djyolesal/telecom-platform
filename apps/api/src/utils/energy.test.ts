import { expectedGasoilGE, analyseGasoilCoherence, analyseLivraison } from './energy';

describe('expectedGasoilGE', () => {
  it('GE permanent : puissance × 0.75 × heures × 0.25', () => {
    expect(expectedGasoilGE(100, 'GE_PERMANENT', 10)).toBeCloseTo(187.5, 5);
  });
  it('GE secours : facteur de charge 0.65', () => {
    expect(expectedGasoilGE(100, 'GE_SECOURS', 10)).toBeCloseTo(162.5, 5);
  });
  it('renvoie 0 si puissance ou heures nulles', () => {
    expect(expectedGasoilGE(0, 'GE_PERMANENT', 10)).toBe(0);
    expect(expectedGasoilGE(100, 'GE_PERMANENT', 0)).toBe(0);
    expect(expectedGasoilGE(100, 'GE_PERMANENT', -5)).toBe(0);
  });
});

describe('analyseGasoilCoherence', () => {
  const seuilPct = 25;
  it('renvoie null si le gasoil consommé est inconnu', () => {
    expect(analyseGasoilCoherence({ consomme: null, attendu: 200, hasHeures: true, seuilPct })).toBeNull();
  });
  it('indisponible si heures GE non calculables', () => {
    const r = analyseGasoilCoherence({ consomme: 200, attendu: 0, hasHeures: false, seuilPct });
    expect(r).toMatch(/indisponible/i);
  });
  it('cohérent dans la tolérance', () => {
    const r = analyseGasoilCoherence({ consomme: 220, attendu: 200, hasHeures: true, seuilPct });
    expect(r).toMatch(/^Cohérent/);
    expect(r).toContain('+10%');
  });
  it('cohérent exactement au seuil (25%)', () => {
    const r = analyseGasoilCoherence({ consomme: 250, attendu: 200, hasHeures: true, seuilPct });
    expect(r).toMatch(/^Cohérent/);
  });
  it('surconsommation au-delà du seuil', () => {
    const r = analyseGasoilCoherence({ consomme: 300, attendu: 200, hasHeures: true, seuilPct });
    expect(r).toMatch(/Surconsommation/);
    expect(r).toContain('+50%');
  });
  it('sous-consommation en deçà du seuil', () => {
    const r = analyseGasoilCoherence({ consomme: 100, attendu: 200, hasHeures: true, seuilPct });
    expect(r).toMatch(/Sous-consommation/);
    expect(r).toContain('-50%');
  });
});

describe('analyseLivraison', () => {
  const seuilPct = 5;
  it('null si volume annoncé inconnu', () => {
    expect(analyseLivraison({ volumeReel: 1000, volumeAnnonce: null, seuilPct })).toBeNull();
    expect(analyseLivraison({ volumeReel: 1000, volumeAnnonce: 0, seuilPct })).toBeNull();
  });
  it('conforme dans la tolérance', () => {
    const r = analyseLivraison({ volumeReel: 1020, volumeAnnonce: 1000, seuilPct });
    expect(r).toMatch(/conforme/i);
    expect(r).toContain('+2%');
  });
  it('manquant si volume réel < annoncé au-delà du seuil', () => {
    const r = analyseLivraison({ volumeReel: 900, volumeAnnonce: 1000, seuilPct });
    expect(r).toMatch(/Manquant/);
    expect(r).toContain('-10%');
  });
  it('surplus si volume réel > annoncé au-delà du seuil', () => {
    const r = analyseLivraison({ volumeReel: 1100, volumeAnnonce: 1000, seuilPct });
    expect(r).toMatch(/Surplus/);
    expect(r).toContain('+10%');
  });
});
