import { moisEntiers } from './bilanCarburant.service';

const d = (iso: string) => new Date(iso);

/**
 * Le bilan sur période ne recalcule un mois que d'une seule façon : dès que la
 * période tient en mois calendaires entiers, c'est la méthode validée le
 * 07/09/2026 qui s'applique. Ce test garde la frontière entre les deux.
 */
describe('moisEntiers - quelle méthode pour quelle période', () => {
  it('reconnaît un mois, borne exclusive (1er du mois suivant)', () => {
    expect(moisEntiers(d('2026-09-01T00:00:00Z'), d('2026-10-01T00:00:00Z')))
      .toEqual([{ annee: 2026, mois: 9 }]);
  });

  it('reconnaît un mois, borne inclusive (dernier jour du mois)', () => {
    // C'est la forme que produit la page : du 01 au 30 septembre.
    expect(moisEntiers(d('2026-09-01T00:00:00Z'), d('2026-09-30T00:00:00Z')))
      .toEqual([{ annee: 2026, mois: 9 }]);
  });

  it('reconnaît un trimestre, et le rend mois par mois', () => {
    expect(moisEntiers(d('2026-07-01T00:00:00Z'), d('2026-09-30T00:00:00Z')))
      .toEqual([{ annee: 2026, mois: 7 }, { annee: 2026, mois: 8 }, { annee: 2026, mois: 9 }]);
  });

  it('traverse un changement d\'année', () => {
    expect(moisEntiers(d('2026-12-01T00:00:00Z'), d('2027-01-31T00:00:00Z')))
      .toEqual([{ annee: 2026, mois: 12 }, { annee: 2027, mois: 1 }]);
  });

  it('refuse une période libre : elle reste sur l\'équation de conservation', () => {
    // Ni le 1er au début, ni une fin de mois à la fin.
    expect(moisEntiers(d('2026-09-05T00:00:00Z'), d('2026-09-25T00:00:00Z'))).toBeNull();
    expect(moisEntiers(d('2026-09-01T00:00:00Z'), d('2026-09-15T00:00:00Z'))).toBeNull();
    expect(moisEntiers(d('2026-09-10T00:00:00Z'), d('2026-09-30T00:00:00Z'))).toBeNull();
  });

  it('refuse un février tronqué au 30', () => {
    // Le 28 ferme février 2026 ; le 30 n'existe pas et ne doit pas être pris
    // pour une fin de mois.
    expect(moisEntiers(d('2026-02-01T00:00:00Z'), d('2026-02-28T00:00:00Z')))
      .toEqual([{ annee: 2026, mois: 2 }]);
    expect(moisEntiers(d('2026-02-01T00:00:00Z'), d('2026-02-27T00:00:00Z'))).toBeNull();
  });

  it('refuse une période absurde ou vide', () => {
    expect(moisEntiers(d('2026-09-01T00:00:00Z'), d('2026-09-01T00:00:00Z'))).toBeNull();
    expect(moisEntiers(d('2026-09-01T00:00:00Z'), d('2020-01-01T00:00:00Z'))).toBeNull();
    // Garde-fou : au-delà de 36 mois, on ne déroule pas la méthode mois par mois.
    expect(moisEntiers(d('2000-01-01T00:00:00Z'), d('2026-12-31T00:00:00Z'))).toBeNull();
  });
});
