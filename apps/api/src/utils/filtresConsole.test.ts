import { clauseFiltre, clausesDepuisRequete, operateursPour, operateurParDefaut, ChampFiltrable } from './filtresConsole';

const texte: ChampFiltrable = { nom: 'nom', type: 'String', kind: 'scalar', obligatoire: true };
const texteVide: ChampFiltrable = { nom: 'ville', type: 'String', kind: 'scalar', obligatoire: false };
const entier: ChampFiltrable = { nom: 'numero', type: 'Int', kind: 'scalar', obligatoire: true };
const decimal: ChampFiltrable = { nom: 'cuveVolumeLitres', type: 'Decimal', kind: 'scalar', obligatoire: false };
const date: ChampFiltrable = { nom: 'dateFin', type: 'DateTime', kind: 'scalar', obligatoire: false };
const booleen: ChampFiltrable = { nom: 'isActive', type: 'Boolean', kind: 'scalar', obligatoire: true };
const statut: ChampFiltrable = { nom: 'statut', type: 'StatutMaintenance', kind: 'enum', obligatoire: false };
const fk: ChampFiltrable = { nom: 'siteId', type: 'String', kind: 'scalar', obligatoire: true, fkVers: 'Site' };
const ENUM = ['PLANIFIEE', 'EN_COURS', 'TERMINEE'];
const J = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('opérateurs proposés selon la colonne', () => {
  it('texte : contient, égal, différent, commence par', () => {
    expect(operateursPour(texte)).toEqual(['contient', 'eq', 'ne', 'commence']);
  });
  it('« vide » n’est proposé que sur une colonne qui peut l’être', () => {
    expect(operateursPour(texteVide)).toContain('vide');
    expect(operateursPour(texte)).not.toContain('vide');
  });
  it('nombre et date : comparaisons', () => {
    expect(operateursPour(entier)).toEqual(['eq', 'ne', 'gt', 'gte', 'lt', 'lte']);
    expect(operateursPour(date)).toEqual(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'vide', 'nonvide']);
  });
  it('énumération : est, n’est pas, parmi', () => {
    expect(operateursPour(statut)).toEqual(['eq', 'ne', 'in', 'vide', 'nonvide']);
  });
  it('clé étrangère : égal ou différent, jamais « contient » sur un uuid', () => {
    expect(operateursPour(fk)).toEqual(['eq', 'ne']);
    expect(operateurParDefaut(fk)).toBe('eq');
    expect(operateurParDefaut(texte)).toBe('contient');
  });
});

describe('dates : un JOUR se lit comme une journée entière', () => {
  it('« le 30 » couvre tout le 30', () => {
    expect(clauseFiltre(date, 'eq', '2026-09-30')).toEqual({ dateFin: { gte: J('2026-09-30'), lt: J('2026-10-01') } });
  });
  it('« jusqu’au 30 » (≤) inclut le 30, « avant le 30 » (<) l’exclut', () => {
    expect(clauseFiltre(date, 'lte', '2026-09-30')).toEqual({ dateFin: { lt: J('2026-10-01') } });
    expect(clauseFiltre(date, 'lt', '2026-09-30')).toEqual({ dateFin: { lt: J('2026-09-30') } });
  });
  it('« après le 1er » (>) commence le 2, « à partir du 1er » (≥) le 1er', () => {
    expect(clauseFiltre(date, 'gt', '2026-09-01')).toEqual({ dateFin: { gte: J('2026-09-02') } });
    expect(clauseFiltre(date, 'gte', '2026-09-01')).toEqual({ dateFin: { gte: J('2026-09-01') } });
  });
  it('une date complète se compare à l’instant', () => {
    expect(clauseFiltre(date, 'lte', '2026-09-30T12:00:00Z')).toEqual({ dateFin: { lte: new Date('2026-09-30T12:00:00Z') } });
  });
  it('refuse une date illisible', () => {
    expect(() => clauseFiltre(date, 'eq', '30/09/2026')).toThrow(/n'est pas une date/);
  });
});

describe('« différent de » garde les lignes vides', () => {
  // NULL <> 'x' ne vaut pas vrai en SQL : un `{ not: x }` seul perdrait les
  // lignes sans valeur, que l'utilisateur veut voir.
  it('sur une énumération qui peut être vide', () => {
    expect(clauseFiltre(statut, 'ne', 'TERMINEE', ENUM)).toEqual({ OR: [{ statut: { not: 'TERMINEE' } }, { statut: null }] });
  });
  it('mais pas sur une colonne obligatoire, qui n’a pas de vide', () => {
    expect(clauseFiltre(entier, 'ne', '3')).toEqual({ numero: { not: 3 } });
  });
  it('« ≠ un jour » sur une date garde aussi les vides', () => {
    expect(clauseFiltre(date, 'ne', '2026-09-30')).toEqual({
      OR: [{ dateFin: { lt: J('2026-09-30') } }, { dateFin: { gte: J('2026-10-01') } }, { dateFin: null }],
    });
  });
});

describe('textes, nombres, énumérations', () => {
  it('texte : insensible à la casse', () => {
    expect(clauseFiltre(texte, 'contient', 'lomé')).toEqual({ nom: { contains: 'lomé', mode: 'insensitive' } });
    expect(clauseFiltre(texte, 'commence', 'ZZ')).toEqual({ nom: { startsWith: 'ZZ', mode: 'insensitive' } });
    expect(clauseFiltre(texte, 'eq', 'Kara')).toEqual({ nom: { equals: 'Kara', mode: 'insensitive' } });
  });
  it('nombre : virgule décimale acceptée, texte refusé', () => {
    expect(clauseFiltre(decimal, 'gte', '1500,5')).toEqual({ cuveVolumeLitres: { gte: 1500.5 } });
    expect(() => clauseFiltre(entier, 'eq', 'douze')).toThrow(/n'est pas un nombre/);
  });
  it('énumération : plusieurs valeurs avec « parmi »', () => {
    expect(clauseFiltre(statut, 'in', 'PLANIFIEE, EN_COURS', ENUM)).toEqual({ statut: { in: ['PLANIFIEE', 'EN_COURS'] } });
  });
  it('énumération : une valeur inconnue est refusée et la liste des valeurs donnée', () => {
    expect(() => clauseFiltre(statut, 'eq', 'INVENTE', ENUM)).toThrow(/Valeurs possibles : PLANIFIEE, EN_COURS, TERMINEE/);
  });
  it('vide / non vide', () => {
    expect(clauseFiltre(date, 'vide', '')).toEqual({ dateFin: null });
    expect(clauseFiltre(date, 'nonvide', '')).toEqual({ dateFin: { not: null } });
  });
  it('booléen : true ou false seulement', () => {
    expect(clauseFiltre(booleen, 'eq', 'false')).toEqual({ isActive: false });
    expect(() => clauseFiltre(booleen, 'eq', 'peut-être')).toThrow(/oui/);
  });
  it('un opérateur sans sens pour la colonne est refusé', () => {
    expect(() => clauseFiltre(booleen, 'gt', 'true')).toThrow(/ne s'applique pas/);
    expect(() => clauseFiltre(fk, 'contient', 'abc')).toThrow(/ne s'applique pas/);
  });
});

describe('lecture de la requête', () => {
  const champs = [texte, date, statut, fk];
  const lire = (q: Record<string, unknown>) =>
    clausesDepuisRequete(q, (n) => champs.find((c) => c.nom === n), (c) => (c.kind === 'enum' ? ENUM : []));

  it('accepte encore la forme historique', () => {
    expect(lire({ f_nom: 'lomé', f_statut: 'TERMINEE' })).toEqual([
      { nom: { contains: 'lomé', mode: 'insensitive' } },
      { statut: 'TERMINEE' },
    ]);
  });
  it('accepte plusieurs bornes sur la même colonne', () => {
    expect(lire({ f_dateFin__gte: '2026-09-01', f_dateFin__lte: '2026-09-30' })).toEqual([
      { dateFin: { gte: J('2026-09-01') } },
      { dateFin: { lt: J('2026-10-01') } },
    ]);
  });
  it('« @null » de la forme historique veut dire « est vide »', () => {
    expect(lire({ f_dateFin: '@null' })).toEqual([{ dateFin: null }]);
  });
  it('une valeur vide de la forme historique est un sélecteur remis à « tous »', () => {
    expect(lire({ f_statut: '' })).toEqual([]);
  });
  it('refuse une colonne inconnue ou non filtrable, et un opérateur inconnu', () => {
    expect(() => lire({ f_passwordHash: 'x' })).toThrow(/colonne inconnue ou non filtrable/);
    expect(() => lire({ f_nom__sql: 'x' })).toThrow(/opérateur « sql » inconnu/);
  });
  it('ignore les paramètres qui ne sont pas des filtres', () => {
    expect(lire({ page: '2', q: 'x', tri: 'nom' })).toEqual([]);
  });
});
