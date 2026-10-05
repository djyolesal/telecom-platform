import { validerSaisieHorsApp, nombreSaisi, dateDeMesure, ANCIENNETE_MAX_JOURS } from './saisieHorsApp';

const MAINTENANT = new Date('2026-10-05T12:00:00Z');
const valider = (corps: unknown) => validerSaisieHorsApp(corps, MAINTENANT);
const base = { siteId: 's1', dateReleve: '2026-09-10T08:30:00Z' };

describe('relevé hors application : date de la mesure', () => {
  it('accepte une date passée', () => {
    expect(dateDeMesure('2026-09-10T08:30:00Z', MAINTENANT)).toEqual(new Date('2026-09-10T08:30:00Z'));
  });

  it('est obligatoire', () => {
    for (const vide of [undefined, null, '']) expect(() => dateDeMesure(vide, MAINTENANT)).toThrow(/requises/);
  });

  // Contrairement à la saisie mobile, on REFUSE : ramener en silence une date
  // aberrante à la borne enregistrerait un relevé à une date que personne n'a écrite.
  it('refuse une date dans le futur', () => {
    expect(() => dateDeMesure('2026-10-06T12:00:00Z', MAINTENANT)).toThrow(/futur/);
  });

  it('tolère quelques minutes de dérive d’horloge', () => {
    expect(() => dateDeMesure('2026-10-05T12:03:00Z', MAINTENANT)).not.toThrow();
  });

  it('refuse un relevé trop ancien, et le dit', () => {
    expect(() => dateDeMesure('2023-01-01T00:00:00Z', MAINTENANT)).toThrow(/trop ancien/);
    const limite = new Date(MAINTENANT.getTime() - ANCIENNETE_MAX_JOURS * 86_400_000 + 3600_000);
    expect(() => dateDeMesure(limite, MAINTENANT)).not.toThrow();
  });

  it('refuse une date illisible', () => {
    expect(() => dateDeMesure('hier soir', MAINTENANT)).toThrow(/invalide/);
  });
});

describe('relevé hors application : nombres', () => {
  it('accepte un nombre ou une saisie à la française', () => {
    expect(nombreSaisi(1234.5, 1e6, 'X')).toBe(1234.5);
    expect(nombreSaisi('12 345,6', 1e6, 'X')).toBe(12345.6);
    expect(nombreSaisi('0', 1e6, 'X')).toBe(0);
  });

  it('un champ vide n’est pas zéro', () => {
    for (const vide of [null, undefined, '', '  ']) expect(nombreSaisi(vide, 1e6, 'X')).toBeNull();
  });

  it('refuse, avec le nom du champ, au lieu de corriger en silence', () => {
    expect(() => nombreSaisi('12 5OO', 1e6, 'Index CEET')).toThrow(/Index CEET invalide/);
    expect(() => nombreSaisi('0x10', 1e6, 'Index CEET')).toThrow(/invalide/);
    expect(() => nombreSaisi(-3, 1e6, 'Volume')).toThrow(/Volume ne peut pas être négatif/);
    expect(() => nombreSaisi('-3', 1e6, 'Volume')).toThrow(/négatif/);
    expect(() => nombreSaisi(2e6, 1e6, 'Volume')).toThrow(/trop élevé/);
    expect(() => nombreSaisi(NaN, 1e6, 'X')).toThrow(/invalide/);
    expect(() => nombreSaisi(true, 1e6, 'X')).toThrow(/invalide/);
  });
});

describe('relevé hors application : saisie complète', () => {
  it('normalise un relevé CEET + GE', () => {
    const s = valider({
      ...base, technicienId: 't1', observations: '  fiche papier  ',
      ceet: { indexCompteur: '15 420' },
      ge: { volumeGasoilLitres: 650, groupes: [{ groupeId: 'g1', indexHeuresGE: '1 260,5' }] },
    });
    expect(s.siteId).toBe('s1');
    expect(s.technicienId).toBe('t1');
    expect(s.observations).toBe('fiche papier');
    expect(s.ceet).toEqual({ indexCompteur: 15420 });
    expect(s.ge).toEqual({ volumeGasoilLitres: 650, hauteurCuveCm: null, groupes: [{ groupeId: 'g1', indexHeuresGE: 1260.5 }] });
    expect(s.solaire).toBeNull();
  });

  it('exige un site', () => {
    expect(() => valider({ dateReleve: base.dateReleve, ceet: { indexCompteur: 1 } })).toThrow(/site est requis/);
  });

  it('exige au moins une mesure', () => {
    expect(() => valider(base)).toThrow(/Aucune mesure/);
    expect(() => valider({ ...base, ceet: { indexCompteur: '' }, ge: { groupes: [{ groupeId: 'g1' }] } })).toThrow(/Aucune mesure/);
  });

  it('ignore un groupe laissé vide mais garde les autres', () => {
    const s = valider({ ...base, ge: { groupes: [{ groupeId: 'g1', indexHeuresGE: '' }, { groupeId: 'g2', indexHeuresGE: 90 }] } });
    expect(s.ge!.groupes).toEqual([{ groupeId: 'g2', indexHeuresGE: 90 }]);
  });

  it('refuse le même groupe saisi deux fois', () => {
    expect(() => valider({ ...base, ge: { groupes: [{ groupeId: 'g1', indexHeuresGE: 1 }, { groupeId: 'g1', indexHeuresGE: 2 }] } })).toThrow(/deux fois/);
  });

  it('accepte une hauteur de cuve seule (le serveur la convertira en litres)', () => {
    const s = valider({ ...base, ge: { hauteurCuveCm: 42.5 } });
    expect(s.ge).toEqual({ volumeGasoilLitres: null, hauteurCuveCm: 42.5, groupes: [] });
  });

  it('accepte une mesure solaire seule', () => {
    expect(valider({ ...base, solaire: { puissanceKva: '3,5' } }).solaire).toEqual({ puissanceKva: 3.5 });
  });

  it('refuse des observations démesurées', () => {
    expect(() => valider({ ...base, ceet: { indexCompteur: 1 }, observations: 'x'.repeat(501) })).toThrow(/trop longues/);
  });

  it('refuse un corps illisible', () => {
    for (const mauvais of [null, undefined, 'texte', [], 12]) expect(() => valider(mauvais)).toThrow(/illisible/);
  });

  it('un index absurde est refusé avec son nom de champ', () => {
    expect(() => valider({ ...base, ceet: { indexCompteur: 5e8 } })).toThrow(/Index du compteur CEET trop élevé/);
  });

  it('porte un code 422', () => {
    try { valider(base); } catch (e) { expect((e as { statusCode: number }).statusCode).toBe(422); }
  });
});
