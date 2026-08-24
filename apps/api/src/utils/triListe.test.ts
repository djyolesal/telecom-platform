import { triListe } from './triListe';

const TRIS = {
  site: (s: 'asc' | 'desc') => ({ site: { nom: s } }),
  dateDebut: (s: 'asc' | 'desc') => ({ dateDebut: s }),
};

describe('triListe (tri délégué des listes paginées)', () => {
  it('traduit la clé en orderBy Prisma avec départage stable', () => {
    expect(triListe({ tri: 'site', sens: 'desc' }, TRIS, { dateDebut: 'desc' }))
      .toEqual([{ site: { nom: 'desc' } }, { dateDebut: 'desc' }]);
  });

  it('sens absent ou invalide → ascendant', () => {
    expect(triListe({ tri: 'dateDebut' }, TRIS)).toEqual([{ dateDebut: 'asc' }]);
    expect(triListe({ tri: 'dateDebut', sens: 'DROP TABLE' }, TRIS)).toEqual([{ dateDebut: 'asc' }]);
  });

  it('clé absente ou hors liste blanche → null (tri métier par défaut)', () => {
    expect(triListe({}, TRIS)).toBeNull();
    expect(triListe({ tri: 'passwordHash' }, TRIS)).toBeNull();
    expect(triListe({ tri: 'constructor' }, TRIS)).toBeNull();
  });
});
