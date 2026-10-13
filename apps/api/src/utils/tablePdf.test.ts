import { buildTablePdf, texteWinAnsi } from './tablePdf';

/**
 * PDF tabulaire : la police standard (Helvetica, WinAnsi) ne connaît pas ≤ ≥ ≈
 * ni les espaces fines - « ≤ 2000 L » s'imprimait « "d 2000 L ». Et une table de
 * contrôle doit pouvoir montrer un message entier (retour à la ligne).
 */
describe('texteWinAnsi', () => {
  it('remplace les signes absents de la police par un équivalent lisible', () => {
    expect(texteWinAnsi('≥ 5 100 h')).toBe('>= 5 100 h');
    expect(texteWinAnsi('≤ 2000 L')).toBe('<= 2000 L');
    expect(texteWinAnsi('≈ 1200 kWh')).toBe('~ 1200 kWh');
    expect(texteWinAnsi('A → B')).toBe('A -> B');
  });

  it('espaces fines et insécables (milliers à la française) deviennent des espaces', () => {
    expect(texteWinAnsi('12 480 h')).toBe('12 480 h');
  });

  it('laisse intact le français courant (accents, guillemets, tiret simple)', () => {
    const s = 'Dépotage « à vérifier » - n°1 · 12,5 %';
    expect(texteWinAnsi(s)).toBe(s);
  });
});

describe('buildTablePdf', () => {
  const long = 'Index horaire GE n°1 saisi (4 800 h) inférieur au dernier index connu (5 100 h le 02/10/2026) - un compteur horaire ne recule pas. '.repeat(3);
  const section = (retourLigne?: boolean) => ({
    name: 'Anomalies',
    columns: [{ header: 'Date', key: 'date', width: 10 }, { header: 'Détail', key: 'message', width: 40 }],
    rows: Array.from({ length: 60 }, (_, i) => ({ date: `0${i % 9 + 1}/10/2026`, message: long })),
    retourLigne,
  });
  const pages = (b: Buffer) => (b.toString('latin1').match(/\/Type \/Page[^s]/g) ?? []).length;

  it('produit un PDF, et le retour à la ligne allonge le document au lieu de tronquer', async () => {
    const coupe = await buildTablePdf('Test', [section(false)]);
    const plein = await buildTablePdf('Test ≥ 1', [section(true)]);
    expect(coupe.subarray(0, 4).toString()).toBe('%PDF');
    expect(plein.subarray(0, 4).toString()).toBe('%PDF');
    expect(pages(plein)).toBeGreaterThan(pages(coupe));
  });
});
