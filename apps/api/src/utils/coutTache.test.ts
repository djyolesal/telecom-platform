import { normaliserCout, COUT_TACHE_MAX } from './coutTache';

describe('coût d’une tâche préventive', () => {
  // Le point central : « pas de prix » et « gratuit » sont deux réponses
  // différentes, et une facture doit pouvoir les distinguer.
  it('distingue l’absence de prix du prix zéro', () => {
    expect(normaliserCout(null)).toBeNull();
    expect(normaliserCout(undefined)).toBeNull();
    expect(normaliserCout('')).toBeNull();
    expect(normaliserCout('   ')).toBeNull();
    expect(normaliserCout(0)).toBe(0);
    expect(normaliserCout('0')).toBe(0);
  });

  it('accepte un nombre ou une saisie à la française', () => {
    expect(normaliserCout(15000)).toBe(15000);
    expect(normaliserCout('15000')).toBe(15000);
    expect(normaliserCout('15 000')).toBe(15000);
    expect(normaliserCout('15 000')).toBe(15000);
    expect(normaliserCout('1 500,50')).toBe(1500.5);
    expect(normaliserCout('1500.5')).toBe(1500.5);
  });

  it('arrondit au centime', () => {
    expect(normaliserCout(10.456)).toBe(10.46);
    expect(normaliserCout('10,454')).toBe(10.45);
  });

  it('refuse ce qui n’est pas un montant', () => {
    for (const mauvais of ['abc', '12abc', '1,2,3', 'NaN', 'Infinity', {}, [], true]) {
      expect(() => normaliserCout(mauvais)).toThrow(/Coût invalide/);
    }
    expect(() => normaliserCout(NaN)).toThrow(/Coût invalide/);
    expect(() => normaliserCout(Infinity)).toThrow(/Coût invalide/);
  });

  it('refuse un coût négatif', () => {
    expect(() => normaliserCout(-1)).toThrow(/négatif/);
    expect(() => normaliserCout('-5')).toThrow(/négatif/);
  });

  it('refuse un montant manifestement faux', () => {
    expect(normaliserCout(COUT_TACHE_MAX)).toBe(COUT_TACHE_MAX);
    expect(() => normaliserCout(COUT_TACHE_MAX + 1)).toThrow(/trop élevé/);
  });

  it('porte un code 422', () => {
    try { normaliserCout('abc'); } catch (e) { expect((e as { statusCode: number }).statusCode).toBe(422); }
  });
});
