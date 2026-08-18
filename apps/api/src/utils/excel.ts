import ExcelJS from 'exceljs';

export interface ExcelColumn {
  header: string;
  key: string;
  width?: number;
}

/** Titre/sous-titre du rapport → feuille « À propos » (bandeau de marque). */
export interface XlsxMeta {
  title: string;
  subtitle?: string;
}

// Charte E&M OpS — mêmes couleurs que le web et le PDF.
const NAVY = 'FF1B3F6B';
const ZEBRA = 'FFF7F9FB';
const INK = 'FF2C3E50';
const GRIS = 'FF6B7280';
const BORDURE = 'FFE5E8EB';

/**
 * Mise en forme commune d'une feuille de données : en-tête navy figé au
 * défilement + filtres automatiques, lignes zébrées, fines bordures.
 * L'en-tête RESTE en ligne 1 : les fichiers exportés (sites, topologie…)
 * demeurent ré-importables tels quels.
 */
function styliserFeuille(ws: ExcelJS.Worksheet, nbCols: number): void {
  if (!nbCols) return;
  const head = ws.getRow(1);
  head.height = 22;
  for (let c = 1; c <= nbCols; c++) {
    const cell = head.getCell(c);
    cell.font = { size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  }
  ws.views = [{ state: 'frozen', ySplit: 1, showGridLines: false }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: nbCols } };

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    row.height = 18;
    for (let c = 1; c <= nbCols; c++) {
      const cell = row.getCell(c);
      cell.font = { size: 10, color: { argb: INK } };
      cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      if (r % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
      cell.border = { bottom: { style: 'hair', color: { argb: BORDURE } } };
      // Injection de formule : une cellule texte issue d'une saisie terrain
      // commençant par = + - @ est interprétée comme une FORMULE par Excel
      // (exécution DDE, exfiltration via HYPERLINK). On la préfixe d'une
      // apostrophe → forcée en texte, comme pour l'export CSV.
      if (typeof cell.value === 'string' && /^[=+\-@\t\r]/.test(cell.value)) {
        cell.value = `'${cell.value}`;
      }
    }
  }
}

/**
 * Feuille « À propos » finale (bandeau de marque, période/sous-titre, date de
 * génération, contenu du classeur). Placée en DERNIER : les imports lisent
 * `worksheets[0]`, qui reste la feuille de données.
 */
function ajouterAPropos(wb: ExcelJS.Workbook, meta: XlsxMeta, feuilles: Array<{ name: string; lignes: number }>): void {
  const ws = wb.addWorksheet('À propos', { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 3 }, { width: 46 }, { width: 24 }, { width: 3 }];

  ws.mergeCells('B2:C2');
  const titre = ws.getCell('B2');
  titre.value = `E&M OpS - ${meta.title}`;
  titre.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  titre.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  titre.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(2).height = 30;

  const genere = new Date().toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lome',
  });
  ws.mergeCells('B3:C3');
  const sous = ws.getCell('B3');
  sous.value = `${meta.subtitle ? `${meta.subtitle} · ` : ''}généré le ${genere} (heure de Lomé)`;
  sous.font = { size: 10, color: { argb: GRIS } };

  const he = ws.getRow(5);
  ['Feuille', 'Lignes'].forEach((h, i) => {
    const c = he.getCell(2 + i);
    c.value = h;
    c.font = { size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    c.alignment = { horizontal: i === 0 ? 'left' : 'right', indent: 1 };
  });
  feuilles.forEach((f, r) => {
    const row = ws.getRow(6 + r);
    row.getCell(2).value = f.name;
    row.getCell(3).value = f.lignes;
    row.getCell(2).font = { size: 10 };
    row.getCell(3).font = { size: 10 };
    row.getCell(3).alignment = { horizontal: 'right', indent: 1 };
    if (r % 2 === 1) {
      row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
      row.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
    }
  });
}

/**
 * Génère un classeur xlsx à partir d'une liste d'objets et renvoie un Buffer.
 * `meta` (titre/sous-titre) ajoute la feuille « À propos » en fin de classeur.
 */
export async function buildXlsx(
  sheetName: string,
  columns: ExcelColumn[],
  rows: Record<string, unknown>[],
  meta?: XlsxMeta
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'E&M OpS';
  wb.created = new Date();

  const ws = wb.addWorksheet(sheetName);
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 20 }));
  rows.forEach((r) => ws.addRow(r));
  styliserFeuille(ws, columns.length);

  if (meta) ajouterAPropos(wb, meta, [{ name: sheetName, lignes: rows.length }]);

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

/** Génère un classeur multi-feuilles (une feuille par entrée) et renvoie un Buffer. */
export async function buildXlsxMulti(
  sheets: Array<{ name: string; columns: ExcelColumn[]; rows: Record<string, unknown>[] }>,
  meta?: XlsxMeta
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'E&M OpS';
  wb.created = new Date();

  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 30));
    ws.columns = s.columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 20 }));
    s.rows.forEach((r) => ws.addRow(r));
    styliserFeuille(ws, s.columns.length);
  }

  if (meta) ajouterAPropos(wb, meta, sheets.map((s) => ({ name: s.name.slice(0, 30), lignes: s.rows.length })));

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

/** Helper Express : positionne les en-têtes de téléchargement xlsx. */
export function setXlsxHeaders(
  res: { setHeader: (k: string, v: string) => void },
  filename: string
): void {
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
}
