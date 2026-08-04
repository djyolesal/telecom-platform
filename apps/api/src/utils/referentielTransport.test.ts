import { normaliserPlaque, plaqueUtilisable, normaliserNom, nomUtilisable, memeChauffeur } from './referentielTransport';

describe('normaliserPlaque', () => {
  it('ramène les trois graphies natives à une seule clé', () => {
    // OCR du bordereau, suggestion de l'interface, saisie libre.
    expect(normaliserPlaque('TG 1234 AB')).toBe('TG1234AB');
    expect(normaliserPlaque('TG-1234-AB')).toBe('TG1234AB');
    expect(normaliserPlaque('tg1234ab')).toBe('TG1234AB');
  });
  it('neutralise les accents et les caractères parasites', () => {
    expect(normaliserPlaque('TG–1234/AB.')).toBe('TG1234AB');
  });
  it('tolère null et undefined', () => {
    expect(normaliserPlaque(null)).toBe('');
    expect(normaliserPlaque(undefined)).toBe('');
  });
});

describe('plaqueUtilisable', () => {
  it('rejette la sentinelle des brouillons', () => {
    // « À AFFECTER » regrouperait tous les brouillons du parc sur un véhicule fantôme.
    expect(plaqueUtilisable('À AFFECTER')).toBe(false);
    expect(plaqueUtilisable('A AFFECTER')).toBe(false);
  });
  it('rejette le vide et les chaînes trop courtes', () => {
    expect(plaqueUtilisable('')).toBe(false);
    expect(plaqueUtilisable('AB')).toBe(false);
  });
  it('accepte une vraie immatriculation', () => {
    expect(plaqueUtilisable('TG 1234 AB')).toBe(true);
  });
});

describe('normaliserNom', () => {
  it('réduit casse, accents et espaces multiples', () => {
    expect(normaliserNom('  Koffi   Jean ')).toBe('KOFFI JEAN');
    expect(normaliserNom('Kossi Élé')).toBe('KOSSI ELE');
  });
});

describe('nomUtilisable', () => {
  it('refuse un nom vide ou purement numérique', () => {
    expect(nomUtilisable('')).toBe(false);
    expect(nomUtilisable('  ')).toBe(false);
    expect(nomUtilisable('123')).toBe(false);
  });
  it('accepte un nom réel', () => {
    expect(nomUtilisable('Koffi Jean')).toBe(true);
  });
});

describe('memeChauffeur', () => {
  it('ignore l’ordre nom/prénom', () => {
    // L'ordre varie d'un document à l'autre : ce n'est pas une anomalie.
    expect(memeChauffeur('KOFFI Jean', 'Jean KOFFI')).toBe(true);
  });
  it('tolère un prénom d’usage supplémentaire', () => {
    expect(memeChauffeur('Koffi Jean', 'Koffi Jean Pierre')).toBe(true);
  });
  it('distingue deux personnes différentes', () => {
    expect(memeChauffeur('Koffi Jean', 'Mensah Paul')).toBe(false);
  });
  it('refuse la comparaison quand un nom manque', () => {
    expect(memeChauffeur('', 'Koffi Jean')).toBe(false);
    expect(memeChauffeur(null, null)).toBe(false);
  });
});
