import { preparerRequete, analyserTexte, valeurCellule, messageErreur } from './consoleSql.service';

/**
 * Le contrôle du TEXTE n'est qu'un confort (la garantie de lecture seule vient
 * du rôle PostgreSQL) : ces tests vérifient qu'il ne casse pas une requête
 * légitime et qu'il donne un message clair au lieu d'une erreur obscure.
 */

jest.mock('../config/database', () => ({ prisma: {} }));
jest.mock('../config/env', () => ({ env: { JWT_SECRET: 'x'.repeat(32), DATABASE_URL: 'postgresql://u:p@h:5432/d' } }));

describe('texte de la requête', () => {
  it('accepte SELECT, WITH, VALUES, TABLE et EXPLAIN', () => {
    for (const q of ['select 1', 'WITH a AS (select 1) select * from a', 'values (1)', 'table sites', 'explain select 1']) {
      expect(() => preparerRequete(q)).not.toThrow();
    }
    expect(preparerRequete('explain select 1').explain).toBe(true);
    expect(preparerRequete('select 1').explain).toBe(false);
  });

  it('tolère le point-virgule final et les espaces', () => {
    expect(preparerRequete('  select 1 ;; \n').sql).toBe('select 1');
  });

  it('refuse deux instructions', () => {
    expect(() => preparerRequete('select 1; drop table sites')).toThrow(/Une seule instruction/);
  });

  // Un point-virgule ou deux tirets DANS une chaîne ne sont ni une fin
  // d'instruction ni un commentaire.
  it('ne prend pas un ; ou -- d’une chaîne pour de la syntaxe', () => {
    expect(preparerRequete("select * from sites where nom like '%--%;%'").sql).toBe("select * from sites where nom like '%--%;%'");
    expect(preparerRequete("select 'l''eau ; -- non' as x").sql).toBe("select 'l''eau ; -- non' as x");
    expect(preparerRequete('select "a;b" from t').sql).toBe('select "a;b" from t');
  });

  it('retire les commentaires, y compris un ; caché dedans', () => {
    expect(preparerRequete('select 1 -- ; drop table sites').sql).toBe('select 1');
    expect(preparerRequete('/* ; */ select 1').sql).toBe('select 1');
  });

  it('refuse ce qui n’est pas une lecture', () => {
    for (const q of ['update sites set nom = 1', 'delete from sites', 'drop table sites', 'set role postgres', 'copy sites to stdout', 'do $$ begin end $$']) {
      expect(() => preparerRequete(q)).toThrow(/lecture seule/);
    }
  });

  it('refuse une requête vide ou démesurée', () => {
    expect(() => preparerRequete('  -- rien\n ')).toThrow(/vide/);
    expect(() => preparerRequete('select ' + 'x'.repeat(20_001))).toThrow(/trop longue/);
    expect(() => preparerRequete(42)).toThrow(/attendue/);
  });

  it('repère les points-virgules hors chaînes', () => {
    expect(analyserTexte("select ';'; select 2").pointsVirgules).toHaveLength(1);
  });
});

describe('cellules du résultat', () => {
  it('rend chaque valeur affichable en JSON', () => {
    expect(valeurCellule(null)).toBeNull();
    expect(valeurCellule(new Date('2026-10-06T10:00:00Z'))).toBe('2026-10-06T10:00:00.000Z');
    expect(valeurCellule(BigInt(12))).toBe('12');
    expect(valeurCellule({ a: 1 })).toBe('{"a":1}');
    expect(valeurCellule(Buffer.from('abc'))).toBe('<binaire, 3 octet(s)>');
    expect(valeurCellule('texte')).toBe('texte');
    expect(valeurCellule(3.5)).toBe(3.5);
  });
});

describe('messages d’erreur', () => {
  it('explique un refus de droit et nomme les colonnes protégées', () => {
    expect(messageErreur({ code: '42501', message: 'permission denied for table users' }))
      .toMatch(/users\.password_hash.*users\.fcm_token/);
  });
  it('explique un dépassement de durée et une écriture refusée', () => {
    expect(messageErreur({ code: '57014', message: 'x' })).toMatch(/dépassé/);
    expect(messageErreur({ code: '25006', message: 'x' })).toMatch(/lecture seule/);
  });
  it('garde le message de PostgreSQL et la position d’une erreur de syntaxe', () => {
    expect(messageErreur({ code: '42601', message: 'syntax error at or near "frm"', position: '10' }))
      .toBe('syntax error at or near "frm" (position 10)');
  });
});
