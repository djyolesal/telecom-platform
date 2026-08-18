import { aggregateCarbone, co2GasoilKg, co2ReseauKg, ReleveCarbone } from './carbon.service';

const F = { gasoilKgCO2L: 2.66, reseauKgCO2Kwh: 0.55 };

function releve(p: Partial<ReleveCarbone>): ReleveCarbone {
  return {
    dateReleve: new Date(),
    source: 'GE',
    gasoilConsommeLitres: null,
    consommationKwh: null,
    siteId: 's1', siteCode: 'STG-001', siteNom: 'Site 1', region: 'Maritime',
    ...p,
  };
}

describe('empreinte carbone - cœur de calcul', () => {
  it('convertit les litres de gasoil GE en kgCO₂ (scope 1)', () => {
    expect(co2GasoilKg(100, F)).toBeCloseTo(266, 5);
  });

  it('convertit les kWh réseau en kgCO₂ (scope 2)', () => {
    expect(co2ReseauKg(1000, F)).toBeCloseTo(550, 5);
  });

  it('ignore les valeurs négatives/absurdes', () => {
    expect(co2GasoilKg(-50, F)).toBe(0);
    expect(co2ReseauKg(-10, F)).toBe(0);
  });

  it('agrège GE + CEET en total, et le solaire en émissions évitées', () => {
    const releves: ReleveCarbone[] = [
      releve({ source: 'GE', gasoilConsommeLitres: 1000 }),   // 2660 kg
      releve({ source: 'CEET', consommationKwh: 2000 }),       // 1100 kg
      releve({ source: 'SOLAIRE', consommationKwh: 500 }),     // 0 émis, 275 kg évités
    ];
    const r = aggregateCarbone(releves, F, 6);
    expect(r.totaux.co2GasoilKg).toBe(2660);
    expect(r.totaux.co2CeetKg).toBe(1100);
    expect(r.totaux.co2TotalKg).toBe(3760);
    expect(r.totaux.co2TotalTonnes).toBe(3.8);
    expect(r.totaux.co2EviteKg).toBe(275); // le solaire ne compte pas dans le total émis
    expect(r.totaux.solaireKwh).toBe(500);
    expect(r.totaux.partGePct).toBe(71); // 2660/3760
  });

  it('classe les régions et les sites par émissions décroissantes', () => {
    const releves: ReleveCarbone[] = [
      releve({ source: 'GE', gasoilConsommeLitres: 100, siteId: 'a', siteCode: 'A', siteNom: 'A', region: 'Kara' }),
      releve({ source: 'GE', gasoilConsommeLitres: 300, siteId: 'b', siteCode: 'B', siteNom: 'B', region: 'Maritime' }),
    ];
    const r = aggregateCarbone(releves, F, 6);
    expect(r.parRegion[0].region).toBe('Maritime');
    expect(r.topSites[0].code).toBe('B');
    expect(r.serieMensuelle).toHaveLength(6);
  });

  it('renvoie des totaux nuls sans relevés (pas de division par zéro)', () => {
    const r = aggregateCarbone([], F, 3);
    expect(r.totaux.co2TotalKg).toBe(0);
    expect(r.totaux.partGePct).toBe(0);
    expect(r.serieMensuelle).toHaveLength(3);
  });
});
