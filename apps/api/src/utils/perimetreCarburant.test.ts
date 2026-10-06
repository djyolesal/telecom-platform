import { sansCarburant, SITES_AVEC_CARBURANT, SITES_SANS_CARBURANT } from './perimetreCarburant';

/**
 * Un site entre dans les écrans carburant s'il a UN GROUPE ou UNE CUVE. Le
 * stock courant et le bilan appliquaient chacun leur définition : l'un l'avait
 * reçue, pas l'autre.
 */
const site = (statutGE: string, cuve: unknown) => ({ statutGE, cuveVolumeLitres: cuve });

describe('sites sans carburant', () => {
  it('sans GE et sans cuve : hors périmètre', () => {
    expect(sansCarburant(site('PAS_DE_GE', null))).toBe(true);
    expect(sansCarburant(site('PAS_DE_GE', 0))).toBe(true);
    expect(sansCarburant(site('PAS_DE_GE', '0'))).toBe(true);
    expect(sansCarburant(site('PAS_DE_GE', undefined))).toBe(true);
  });

  // Une cuve sans groupe reste du gasoil stocké : elle ne doit pas disparaître.
  it('une cuve suffit à rester dans le périmètre', () => {
    expect(sansCarburant(site('PAS_DE_GE', 2000))).toBe(false);
    expect(sansCarburant(site('PAS_DE_GE', '2000.00'))).toBe(false);
  });

  it('un groupe suffit, même sans cuve renseignée', () => {
    expect(sansCarburant(site('GE_SECOURS', null))).toBe(false);
    expect(sansCarburant(site('GE_PERMANENT', 0))).toBe(false);
  });

  it('un groupe et une cuve : dans le périmètre', () => {
    expect(sansCarburant(site('GE_SECOURS', 1500))).toBe(false);
  });

  // Une cuve de valeur négative ou illisible n'est pas une cuve.
  it('une cuve négative ou illisible n’en est pas une', () => {
    expect(sansCarburant(site('PAS_DE_GE', -5))).toBe(true);
    expect(sansCarburant(site('PAS_DE_GE', 'abc'))).toBe(true);
  });
});

describe('les requêtes Prisma disent la même chose que le prédicat', () => {
  // On ne peut pas interroger une base ici : on vérifie que la forme des
  // clauses porte bien les deux conditions, et que le complément NOMME le cas
  // NULL (NOT (cuve > 0) vaut NULL quand la cuve est NULL : la ligne serait
  // exclue et le compteur rendrait zéro).
  it('« avec carburant » = un groupe OU une cuve', () => {
    expect(SITES_AVEC_CARBURANT.OR).toEqual([
      { statutGE: { not: 'PAS_DE_GE' } },
      { cuveVolumeLitres: { gt: 0 } },
    ]);
  });

  it('« sans carburant » = pas de groupe ET (cuve nulle OU égale à zéro)', () => {
    expect(SITES_SANS_CARBURANT.statutGE).toBe('PAS_DE_GE');
    expect(SITES_SANS_CARBURANT.OR).toEqual([{ cuveVolumeLitres: null }, { cuveVolumeLitres: 0 }]);
    expect(JSON.stringify(SITES_SANS_CARBURANT)).not.toContain('"NOT"');
  });
});
