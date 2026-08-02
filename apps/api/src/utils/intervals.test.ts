import { minutesUnion, minutesUnionParCle, pousser, Intervalle } from './intervals';

const iv = (h1: number, h2: number): Intervalle => ({
  debut: new Date(Date.UTC(2026, 6, 1, h1)),
  fin: new Date(Date.UTC(2026, 6, 1, h2)),
});

describe('minutesUnion (downtime réseau)', () => {
  it('liste vide → 0', () => {
    expect(minutesUnion([])).toBe(0);
  });

  it('intervalle simple → durée exacte', () => {
    expect(minutesUnion([iv(8, 14)])).toBe(360);
  });

  it('le cas réel du rapport NOC : 4 lignes identiques (2G/3G/4G/5G) ne comptent qu’une fois', () => {
    const panne = iv(20, 26 - 20 + 20); // 20:00 → 02:00 le lendemain, soit 6 h
    const memePanne = [panne, panne, panne, panne];
    expect(minutesUnion(memePanne)).toBe(minutesUnion([panne]));
  });

  it('intervalles disjoints → somme', () => {
    expect(minutesUnion([iv(0, 2), iv(5, 6)])).toBe(180);
  });

  it('chevauchement partiel → union, pas somme', () => {
    // 8→12 et 10→14 = 6 h réelles (et non 8 h).
    expect(minutesUnion([iv(8, 12), iv(10, 14)])).toBe(360);
  });

  it('intervalle inclus dans un autre → ignoré', () => {
    expect(minutesUnion([iv(8, 20), iv(10, 12)])).toBe(720);
  });

  it('ordre d’entrée sans influence', () => {
    const desordre = [iv(10, 14), iv(0, 2), iv(8, 12)];
    expect(minutesUnion(desordre)).toBe(minutesUnion([iv(0, 2), iv(8, 14)]));
  });

  it('intervalles contigus → fusionnés (pas de trou artificiel)', () => {
    expect(minutesUnion([iv(8, 10), iv(10, 12)])).toBe(240);
  });
});

describe('minutesUnionParCle (agrégation multi-sites)', () => {
  it('somme les unions site par site, sans les mélanger', () => {
    const m = new Map<string, Intervalle[]>();
    // Site A : deux lignes de la même panne de 6 h → 6 h.
    pousser(m, 'A', iv(8, 14));
    pousser(m, 'A', iv(8, 14));
    // Site B : une panne de 2 h.
    pousser(m, 'B', iv(0, 2));
    expect(minutesUnionParCle(m)).toBe(360 + 120);
  });

  it('deux sites en panne simultanée comptent chacun leur downtime', () => {
    const m = new Map<string, Intervalle[]>();
    pousser(m, 'A', iv(8, 10));
    pousser(m, 'B', iv(8, 10));
    expect(minutesUnionParCle(m)).toBe(240);
  });
});
