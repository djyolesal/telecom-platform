import { filtrerColonnes, TabularSheet } from './exporter';

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
