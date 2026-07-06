import { Response } from 'express';
import { buildXlsx, buildXlsxMulti, setXlsxHeaders, ExcelColumn } from './excel';
import { buildTablePdf } from './tablePdf';

export interface TabularSheet {
  name: string;
  columns: ExcelColumn[];
  rows: Record<string, unknown>[];
}

/**
 * Envoie un export tabulaire au format demandé : les MÊMES colonnes/lignes
 * produisent l'xlsx (une feuille par section) ou le pdf (une table par section).
 */
export async function sendTabular(
  res: Response,
  format: string | undefined,
  baseName: string,
  title: string,
  sheets: TabularSheet[],
  subtitle?: string
): Promise<void> {
  if (format === 'pdf') {
    const buffer = await buildTablePdf(title, sheets, subtitle);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.pdf"`);
    res.send(buffer);
    return;
  }
  const buffer = sheets.length === 1
    ? await buildXlsx(sheets[0].name, sheets[0].columns, sheets[0].rows)
    : await buildXlsxMulti(sheets);
  setXlsxHeaders(res, `${baseName}.xlsx`);
  res.send(buffer);
}
