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
    derniereMesure: null, heuresGEJour: null,
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

  it('découpe un besoin supérieur à la capacité en plusieurs passages (rien perdu)', () => {
    const t = suggestTournees([site({ quantiteRecommandee: 15000 })], 10000);
    // 15 000 L / camion 10 000 → 2 tournées (10 000 + 5 000), surplus conservé.
    expect(t).toHaveLength(2);
    const volumeTotal = t.reduce((s, x) => s + x.total, 0);
    expect(volumeTotal).toBe(15000);
    // Chaque part est marquée passage i / 2.
    const parts = t.flatMap((x) => x.sites.map((s) => s.quantite)).sort((a, b) => b - a);
    expect(parts).toEqual([10000, 5000]);
    expect(t.every((x) => x.sites.every((s) => s.nbPassages === 2))).toBe(true);
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

// ── Estimation découplée de la consommation (GE secours réaliste) ──
import { estimerConsoJour, heuresJourDepuisIndex, tauxHoraireReel, mediane, ReleveConsoLite } from './replenishment.service';

const J = 86_400_000;
const T0 = new Date('2026-06-01T08:00:00Z').getTime();
const rel = (jour: number, p: Partial<ReleveConsoLite>): ReleveConsoLite => ({
  date: new Date(T0 + jour * J), groupeId: p.groupeId ?? 'g1',
  conso: p.conso ?? null, heures: p.heures ?? null, index: p.index ?? null,
});

describe('heuresJourDepuisIndex', () => {
  it('déduit les h/j du compteur horaire (Δindex/Δjours)', () => {
    // 40 h de marche en 10 jours → 4 h/j constants.
    const h = heuresJourDepuisIndex([rel(0, { index: 1000 }), rel(5, { index: 1020 }), rel(10, { index: 1040 })]);
    expect(h).toBeCloseTo(4, 1);
  });

  it('somme les groupes d\'un site multi-GE et rejette les index aberrants', () => {
    const h = heuresJourDepuisIndex([
      rel(0, { groupeId: 'g1', index: 100 }), rel(10, { groupeId: 'g1', index: 130 }), // 3 h/j
      rel(0, { groupeId: 'g2', index: 500 }), rel(10, { groupeId: 'g2', index: 520 }), // 2 h/j
      rel(11, { groupeId: 'g2', index: 100 }), // compteur remplacé (recul) → ignoré
    ]);
    expect(h).toBeCloseTo(5, 1);
  });

  it('null sans aucun index', () => {
    expect(heuresJourDepuisIndex([rel(0, { conso: 50 }), rel(5, { conso: 40 })])).toBeNull();
  });
});

describe('tauxHoraireReel', () => {
  it('Σ litres ÷ Σ heures sur les relevés complets', () => {
    // 120 L pour 30 h → 4 L/h.
    const t = tauxHoraireReel([rel(0, { conso: 80, heures: 20 }), rel(5, { conso: 40, heures: 10 })]);
    expect(t).toBeCloseTo(4, 2);
  });

  it('null si moins de 10 h cumulées (trop bruité)', () => {
    expect(tauxHoraireReel([rel(0, { conso: 20, heures: 5 })])).toBeNull();
  });
});

describe('estimerConsoJour', () => {
  const base = { litresParHeureTheorique: 10, heuresJourTheorique: 8 };

  it('priorité 1 : débit réel × heures compteur (source horametre)', () => {
    // Compteur : 4 h/j ; débit réel : 120 L / 30 h = 4 L/h → 16 L/j (et non 80 L/j théoriques).
    const e = estimerConsoJour({
      ...base,
      releves: [
        rel(0, { index: 1000, conso: 80, heures: 20 }),
        rel(5, { index: 1020, conso: 40, heures: 10 }),
        rel(10, { index: 1040 }),
      ],
    });
    expect(e.source).toBe('horametre');
    expect(e.consoJour).toBeCloseTo(16, 0);
    expect(e.heuresJour).toBeCloseTo(4, 1);
    expect(e.tauxHoraireLh).toBeCloseTo(4, 1);
  });

  it('priorité 2 : EWMA des litres quand les heures manquent', () => {
    const e = estimerConsoJour({ ...base, releves: [rel(0, { conso: 50 }), rel(5, { conso: 100 }), rel(10, { conso: 100 })] });
    expect(e.source).toBe('historique');
    expect(e.consoJour).toBeGreaterThan(0);
  });

  it('priorité 4 : médiane régionale × débit théorique quand le site n\'a rien', () => {
    const e = estimerConsoJour({ ...base, releves: [], heuresJourRegion: 2.5 });
    expect(e.source).toBe('regional');
    expect(e.consoJour).toBeCloseTo(25, 1); // 10 L/h × 2,5 h/j
  });

  it('priorité 5 : théorique kVA en dernier recours (8 h/j × 10 L/h)', () => {
    const e = estimerConsoJour({ ...base, releves: [] });
    expect(e.source).toBe('theorique');
    expect(e.consoJour).toBeCloseTo(80, 1);
  });
});

describe('mediane', () => {
  it('impair, pair, vide', () => {
    expect(mediane([3, 1, 2])).toBe(2);
    expect(mediane([1, 2, 3, 10])).toBe(2.5);
    expect(mediane([])).toBeNull();
  });
});
