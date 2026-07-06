import ExcelJS from 'exceljs';

export interface ExcelColumn {
  header: string;
  key: string;
  width?: number;
}

/**
 * Génère un classeur xlsx à partir d'une liste d'objets et renvoie un Buffer.
 */
export async function buildXlsx(
  sheetName: string,
  columns: ExcelColumn[],
  rows: Record<string, unknown>[]
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'E&M OpS';
  wb.created = new Date();

  const ws = wb.addWorksheet(sheetName);
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 20 }));

  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1B3F6B' },
  };
  ws.getRow(1).alignment = { vertical: 'middle' };

  rows.forEach((r) => ws.addRow(r));
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

/** Génère un classeur multi-feuilles (une feuille par entrée) et renvoie un Buffer. */
export async function buildXlsxMulti(
  sheets: Array<{ name: string; columns: ExcelColumn[]; rows: Record<string, unknown>[] }>
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'E&M OpS';
  wb.created = new Date();

  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 30));
    ws.columns = s.columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 20 }));
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B3F6B' } };
    ws.getRow(1).alignment = { vertical: 'middle' };
    s.rows.forEach((r) => ws.addRow(r));
    if (s.columns.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.columns.length } };
  }

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
