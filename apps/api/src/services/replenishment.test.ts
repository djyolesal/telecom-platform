import { suggestTournees, SiteForecast } from './replenishment.service';

let seq = 0;
function site(p: Partial<SiteForecast>): SiteForecast {
  seq += 1;
  return {
    siteId: p.siteId ?? `s${seq}`, code: p.code ?? `S${seq}`, nom: p.nom ?? `Site ${seq}`,
    region: p.region ?? 'Maritime',
    latitude: p.latitude ?? null, longitude: p.longitude ?? null,
    capaciteCuve: 10000, stockActuel: 0,
    consoJour: 100, consoTheoriqueJour: 100, tendance: 'STABLE', source: 'historique',
    autonomieJours: 5, dateRupture: null, dateLivraisonCible: null, joursAvantLivraison: 5,
    quantiteRecommandee: p.quantiteRecommandee ?? 1000, priorite: 'URGENT',
  };
}

describe('suggestTournees', () => {
  it('aucune tournée si aucune quantité à livrer', () => {
    const t = suggestTournees([site({ quantiteRecommandee: 0 })], 10000);
    expect(t).toHaveLength(0);
  });

  it('respecte la capacité du camion (bin-packing)', () => {
    const sites = [
      site({ quantiteRecommandee: 4000, latitude: 6.1, longitude: 1.2 }),
      site({ quantiteRecommandee: 4000, latitude: 6.2, longitude: 1.3 }),
      site({ quantiteRecommandee: 4000, latitude: 6.3, longitude: 1.4 }),
    ];
    const t = suggestTournees(sites, 10000);
    expect(t.length).toBe(2); // 4000+4000 puis 4000
    for (const tour of t) expect(tour.total).toBeLessThanOrEqual(10000);
    const totalSites = t.reduce((s, x) => s + x.sites.length, 0);
    expect(totalSites).toBe(3); // tous les sites placés
  });

  it('ne mélange pas les régions dans une tournée', () => {
    const sites = [
      site({ region: 'Maritime', quantiteRecommandee: 2000 }),
      site({ region: 'Plateaux', quantiteRecommandee: 2000 }),
    ];
    const t = suggestTournees(sites, 10000);
    for (const tour of t) {
      const regions = new Set(tour.sites.map((s) => s.siteId));
      expect(regions.size).toBeGreaterThan(0);
    }
    expect(t.length).toBe(2); // une tournée par région
  });

  it('plafonne une quantité supérieure à la capacité', () => {
    const t = suggestTournees([site({ quantiteRecommandee: 15000 })], 10000);
    expect(t).toHaveLength(1);
    expect(t[0].sites[0].quantite).toBe(10000);
    expect(t[0].total).toBe(10000);
  });

  it('calcule le taux de remplissage et la distance', () => {
    const t = suggestTournees([
      site({ quantiteRecommandee: 5000, latitude: 6.1, longitude: 1.2 }),
      site({ quantiteRecommandee: 5000, latitude: 6.5, longitude: 1.6 }),
    ], 10000);
    expect(t).toHaveLength(1);
    expect(t[0].tauxRemplissage).toBe(100);
    expect(t[0].distanceKm).toBeGreaterThan(0); // deux points distincts
  });

  it('inclut les sites sans coordonnées GPS', () => {
    const t = suggestTournees([
      site({ quantiteRecommandee: 3000, latitude: null, longitude: null }),
      site({ quantiteRecommandee: 3000, latitude: 6.2, longitude: 1.3 }),
    ], 10000);
    const totalSites = t.reduce((s, x) => s + x.sites.length, 0);
    expect(totalSites).toBe(2);
  });
});
