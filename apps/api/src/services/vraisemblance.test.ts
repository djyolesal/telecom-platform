import { AvertissementSaisie, traceConfirmation } from './vraisemblance.service';

/**
 * Les CODES sont un contrat : ils sont stockés en base et servent à compter et
 * comparer d'un mois sur l'autre. En renommer un silencieusement couperait
 * l'historique en deux.
 */
const CODES_ATTENDUS = [
  'CUVE_DEPASSEE', 'INDEX_GE_RECULE', 'HEURES_GE_ABERRANTES',
  'INDEX_CEET_RECULE', 'CONSO_CEET_ABERRANTE',
  'STOCK_AVANT_CUVE', 'STOCK_APRES_CUVE', 'STOCK_AVANT_HAUSSE', 'DEPOTAGE_DOUBLON',
] as const;

describe('anomalies de saisie', () => {
  it('chaque code reste assignable au type (aucun renommage silencieux)', () => {
    for (const code of CODES_ATTENDUS) {
      const a: AvertissementSaisie = { code, champ: 'x', message: 'test' };
      expect(a.code).toBe(code);
    }
  });

  it('la trace lisible reprend chaque message', () => {
    // Le texte reste dans les observations : la fiche et le PDF doivent
    // continuer à montrer ce que le technicien a confirmé.
    const texte = traceConfirmation([
      { code: 'CUVE_DEPASSEE', champ: 'volumeGasoilLitres', message: 'Volume au-dessus de la cuve.' },
      { code: 'INDEX_GE_RECULE', champ: 'indexHeuresGE', message: 'Index en baisse.' },
    ]);
    expect(texte).toContain('Volume au-dessus de la cuve.');
    expect(texte).toContain('Index en baisse.');
    expect(texte.split('\n')).toHaveLength(3); // en-tête + deux lignes
  });
});
