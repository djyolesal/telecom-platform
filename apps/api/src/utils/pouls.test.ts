import { bucketsHoraires, compterParHeure, niveauAgitation } from './pouls';

describe('pouls — ligne de vie 24 h', () => {
  const now = new Date('2026-08-29T14:37:22Z');

  it('produit 24 seaux horaires, du plus ancien à l\'heure en cours', () => {
    const b = bucketsHoraires(now);
    expect(b).toHaveLength(24);
    expect(b[23].toISOString()).toBe('2026-08-29T14:00:00.000Z');
    expect(b[0].toISOString()).toBe('2026-08-28T15:00:00.000Z');
    // pas strictement croissant → pas de trou ni d'inversion
    for (let i = 1; i < b.length; i++) {
      expect(b[i].getTime() - b[i - 1].getTime()).toBe(3_600_000);
    }
  });

  it('compte chaque date dans son seau', () => {
    const b = bucketsHoraires(now);
    const counts = compterParHeure(
      [
        new Date('2026-08-29T14:05:00Z'), // heure en cours → dernier seau
        new Date('2026-08-29T14:59:59Z'),
        new Date('2026-08-28T15:00:00Z'), // borne exacte du premier seau
        new Date('2026-08-28T14:59:59Z'), // hors fenêtre → ignorée
        new Date('2026-08-29T02:30:00Z'),
      ],
      b,
    );
    expect(counts[23]).toBe(2);
    expect(counts[0]).toBe(1);
    expect(counts.reduce((s, x) => s + x, 0)).toBe(4);
  });

  it('gradue l\'agitation', () => {
    expect(niveauAgitation({ coupuresSiteEntierEnCours: 0, incidentsCritiquesEnCours: 0, coupuresEnCours: 0, incidentsEnCours: 0 })).toBe('CALME');
    expect(niveauAgitation({ coupuresSiteEntierEnCours: 0, incidentsCritiquesEnCours: 0, coupuresEnCours: 2, incidentsEnCours: 0 })).toBe('ACTIF');
    expect(niveauAgitation({ coupuresSiteEntierEnCours: 1, incidentsCritiquesEnCours: 0, coupuresEnCours: 1, incidentsEnCours: 0 })).toBe('CRITIQUE');
    expect(niveauAgitation({ coupuresSiteEntierEnCours: 0, incidentsCritiquesEnCours: 1, coupuresEnCours: 0, incidentsEnCours: 1 })).toBe('CRITIQUE');
  });
});
