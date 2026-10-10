import { joursInaccessibles, moisJustifie } from './inaccessibilite';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const JUIN = [d('2026-06-01'), d('2026-07-01')] as const;

describe('jours d\'inaccessibilité dans un mois', () => {
  it('fin incluse, bornée au mois', () => {
    expect(joursInaccessibles([{ debut: d('2026-06-10'), fin: d('2026-06-16') }], ...JUIN)).toBe(7);
    expect(joursInaccessibles([{ debut: d('2026-05-20'), fin: d('2026-06-03') }], ...JUIN)).toBe(3);
  });
  it('période encore ouverte : jusqu\'à la fin du mois', () => {
    expect(joursInaccessibles([{ debut: d('2026-06-25'), fin: null }], ...JUIN)).toBe(6);
  });
  it('périodes qui se chevauchent : jours comptés une fois', () => {
    expect(joursInaccessibles([
      { debut: d('2026-06-01'), fin: d('2026-06-10') },
      { debut: d('2026-06-05'), fin: d('2026-06-12') },
    ], ...JUIN)).toBe(12);
  });
});

describe('tâche non réalisée justifiée', () => {
  it('à partir du seuil (7 jours par défaut), pas en dessous', () => {
    expect(moisJustifie([{ debut: d('2026-06-10'), fin: d('2026-06-16') }], ...JUIN, 7)).toBe(true);
    expect(moisJustifie([{ debut: d('2026-06-10'), fin: d('2026-06-15') }], ...JUIN, 7)).toBe(false);
  });
  it('aucune période : jamais justifiée', () => {
    expect(moisJustifie([], ...JUIN, 7)).toBe(false);
  });
  it('seuil supérieur à la longueur du mois : le mois entier suffit', () => {
    expect(moisJustifie([{ debut: d('2026-05-01'), fin: null }], ...JUIN, 45)).toBe(true);
  });
});
