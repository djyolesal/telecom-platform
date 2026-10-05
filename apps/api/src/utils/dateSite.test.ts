import { dateMiseEnService, texteOuNull, ANNEE_MIN_MISE_EN_SERVICE } from './dateSite';

const AUJOURDHUI = new Date('2026-10-05T12:00:00Z');
const d = (s: string) => dateMiseEnService(s, AUJOURDHUI);

describe('date de mise en service', () => {
  // Le cas de la panne : le formulaire envoie un jour seul, que la base refusait.
  it('accepte la date du formulaire (AAAA-MM-JJ) et la ramène à minuit UTC', () => {
    expect(d('2022-10-03')).toEqual(new Date('2022-10-03T00:00:00.000Z'));
  });

  it('accepte un horodatage complet et n’en garde que le jour', () => {
    expect(d('2022-10-03T00:00:00.000Z')).toEqual(new Date('2022-10-03T00:00:00.000Z'));
    // Un instant tardif ne bascule pas au jour suivant : on lit le jour écrit.
    expect(d('2022-10-03T23:59:59.000Z')).toEqual(new Date('2022-10-03T00:00:00.000Z'));
  });

  it('une absence de date est null, jamais une erreur', () => {
    expect(d('')).toBeNull();
    expect(d('   ')).toBeNull();
    expect(dateMiseEnService(null)).toBeNull();
    expect(dateMiseEnService(undefined)).toBeNull();
  });

  it('accepte une Date JS', () => {
    expect(dateMiseEnService(new Date('2022-10-03T15:00:00Z'), AUJOURDHUI)).toEqual(new Date('2022-10-03T00:00:00.000Z'));
  });

  it('refuse ce qui n’est pas une date, avec un message qui dit quel champ', () => {
    for (const mauvais of ['03/10/2022', '3 octobre 2022', 'demain', '2022-1-3', '20221003', 12345, {}, true]) {
      expect(() => dateMiseEnService(mauvais, AUJOURDHUI)).toThrow(/Date de mise en service invalide/);
    }
    expect(() => dateMiseEnService(new Date('nope'), AUJOURDHUI)).toThrow(/invalide/);
  });

  // 2022-02-31 « roule » vers le 3 mars sans erreur dans JS : accepter reviendrait
  // à enregistrer une date que personne n'a saisie.
  it('refuse un jour qui n’existe pas au calendrier', () => {
    expect(() => d('2022-02-31')).toThrow(/invalide/);
    expect(() => d('2022-13-01')).toThrow(/invalide/);
    expect(() => d('2022-04-31')).toThrow(/invalide/);
    expect(d('2024-02-29')).toEqual(new Date('2024-02-29T00:00:00.000Z')); // année bissextile
    expect(() => d('2023-02-29')).toThrow(/invalide/);
  });

  it('refuse l’invraisemblable : avant le réseau, ou dans le futur lointain', () => {
    expect(() => d(`${ANNEE_MIN_MISE_EN_SERVICE - 1}-12-31`)).toThrow(/invraisemblable/);
    expect(() => d('0022-10-03')).toThrow(/invraisemblable/);
    expect(d(`${ANNEE_MIN_MISE_EN_SERVICE}-01-01`)).not.toBeNull();
    expect(() => d('2202-10-03')).toThrow(/futur/);
    // Un site déclaré peu avant son ouverture reste possible.
    expect(d('2027-03-01')).toEqual(new Date('2027-03-01T00:00:00.000Z'));
  });

  it('porte un code 422', () => {
    try { d('abc'); } catch (e) { expect((e as { statusCode: number }).statusCode).toBe(422); }
  });
});

describe('texte libre de formulaire', () => {
  it('vide ou blanc devient null, sinon nettoyé', () => {
    expect(texteOuNull('')).toBeNull();
    expect(texteOuNull('   ')).toBeNull();
    expect(texteOuNull(null)).toBeNull();
    expect(texteOuNull(undefined)).toBeNull();
    expect(texteOuNull('  BTS ')).toBe('BTS');
  });
});
