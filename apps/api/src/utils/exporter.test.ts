import { filtrerColonnes, colonnesSelonRole, feuillesSelonRole, TabularSheet } from './exporter';

const sheet = (cols: string[]): TabularSheet => ({
  name: 'Feuille',
  columns: cols.map((c) => ({ key: c, header: c.toUpperCase() })),
  rows: [],
});

describe('filtrerColonnes (sélection de colonnes à l\'export)', () => {
  it('sans paramètre : toutes les colonnes', () => {
    const out = filtrerColonnes([sheet(['code', 'nom', 'region'])], undefined);
    expect(out[0].columns.map((c) => c.key)).toEqual(['code', 'nom', 'region']);
  });

  it('filtre par clés en conservant l\'ordre d\'origine', () => {
    const out = filtrerColonnes([sheet(['code', 'nom', 'region'])], 'region,code');
    expect(out[0].columns.map((c) => c.key)).toEqual(['code', 'region']);
  });

  it('accepte aussi les en-têtes affichés', () => {
    const out = filtrerColonnes([sheet(['code', 'nom'])], 'NOM');
    expect(out[0].columns.map((c) => c.key)).toEqual(['nom']);
  });

  it('feuille sans correspondance : garde toutes ses colonnes (multi-feuilles)', () => {
    const out = filtrerColonnes([sheet(['code', 'nom']), sheet(['volume'])], 'code');
    expect(out[0].columns.map((c) => c.key)).toEqual(['code']);
    expect(out[1].columns.map((c) => c.key)).toEqual(['volume']);
  });
});

describe('code du site : réservé à l’administration', () => {
  const colonnes = (role: string | undefined, cols: Array<[string, string]>) =>
    colonnesSelonRole(cols.map(([key, header]) => ({ key, header })), role).map((c) => c.key);

  it('l’ADMIN garde la colonne code', () => {
    expect(colonnes('ADMIN', [['code', 'Code'], ['nom', 'Site']])).toEqual(['code', 'nom']);
  });

  it('les autres rôles ne la reçoivent pas', () => {
    for (const role of ['MANAGER', 'NOC', 'SUPERVISEUR', 'TECHNICIEN', 'TRANSPORTEUR', undefined]) {
      expect(colonnes(role, [['code', 'Code'], ['nom', 'Site']])).toEqual(['nom']);
    }
  });

  // Les exports n'appellent pas tous la colonne de la même façon : « Code » sur
  // une clé `site` (plan de livraison), `siteCode` dans les bilans. Les trois
  // désignent la même donnée et doivent tomber sous la même règle.
  it('reconnaît les trois écritures en vigueur', () => {
    expect(colonnes('MANAGER', [['site', 'Code'], ['nom', 'Site']])).toEqual(['nom']);
    expect(colonnes('MANAGER', [['siteCode', 'Code'], ['siteNom', 'Site']])).toEqual(['siteNom']);
    expect(colonnes('MANAGER', [['code', 'code'], ['nom', 'nom']])).toEqual(['nom']);
  });

  // Un code d'une AUTRE nature n'est pas concerné : rien ne justifie de cacher
  // le code d'une anomalie ou d'une tâche.
  it('ne touche pas aux codes qui ne sont pas ceux d’un site', () => {
    expect(colonnes('MANAGER', [['codeAnomalie', 'Code anomalie'], ['libelle', 'Libellé']]))
      .toEqual(['codeAnomalie', 'libelle']);
  });

  it('s’applique à chaque feuille d’un classeur', () => {
    const out = feuillesSelonRole([sheet(['code', 'nom']), sheet(['siteCode', 'region'])], 'NOC');
    expect(out.map((s) => s.columns.map((c) => c.key))).toEqual([['nom'], ['region']]);
  });
});
