import { Response } from 'express';
import { buildXlsx, buildXlsxMulti, setXlsxHeaders, ExcelColumn } from './excel';
import { buildTablePdf } from './tablePdf';

/**
 * Plafond de lignes par export : ExcelJS matérialise chaque cellule stylée en
 * mémoire (~1 Ko), et le conteneur API est limité à 1 Go — sans plafond, un
 * export du parc entier provoquait un OOM-kill. Les gros volumes passent par un
 * filtre de période côté appelant.
 */
export const EXPORT_MAX = 5000;

export interface TabularSheet {
  name: string;
  columns: ExcelColumn[];
  rows: Record<string, unknown>[];
}

/**
 * Sélection de colonnes à l'export : `?colonnes=cle1,cle2` (clés OU en-têtes)
 * restreint chaque feuille aux colonnes demandées, dans leur ordre d'origine.
 * Une feuille dont aucune colonne ne correspond garde toutes les siennes
 * (les exports multi-feuilles n'ont pas les mêmes colonnes partout).
 */
export function filtrerColonnes(sheets: TabularSheet[], colonnes: string | undefined): TabularSheet[] {
  if (!colonnes) return sheets;
  const keep = new Set(colonnes.split(',').map((x) => x.trim()).filter(Boolean));
  if (!keep.size) return sheets;
  return sheets.map((s) => {
    const filtered = s.columns.filter((c) => keep.has(c.key) || keep.has(c.header));
    return filtered.length ? { ...s, columns: filtered } : s;
  });
}

/**
 * Envoie un export tabulaire au format demandé : les MÊMES colonnes/lignes
 * produisent l'xlsx (une feuille par section) ou le pdf (une table par section).
 *
 * Deux comportements pilotés par la query (lue sur res.req, donc AUCUN
 * changement dans les contrôleurs) :
 *  - `?colonnes=?`          → renvoie en JSON la liste des colonnes disponibles
 *                             (permet au web d'afficher le sélecteur) ;
 *  - `?colonnes=cle1,cle2`  → n'exporte que ces colonnes.
 */
export async function sendTabular(
  res: Response,
  format: string | undefined,
  baseName: string,
  title: string,
  sheets: TabularSheet[],
  subtitle?: string
): Promise<void> {
  const colonnes = typeof res.req?.query?.colonnes === 'string' ? (res.req.query.colonnes as string) : undefined;
  if (colonnes === '?') {
    res.json({
      success: true,
      data: sheets.map((s) => ({ feuille: s.name, colonnes: s.columns.map((c) => ({ key: c.key, header: c.header })) })),
    });
    return;
  }
  const finalSheets = filtrerColonnes(sheets, colonnes);

  if (format === 'pdf') {
    const buffer = await buildTablePdf(title, finalSheets, subtitle);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.pdf"`);
    res.send(buffer);
    return;
  }
  const buffer = finalSheets.length === 1
    ? await buildXlsx(finalSheets[0].name, finalSheets[0].columns, finalSheets[0].rows, { title, subtitle })
    : await buildXlsxMulti(finalSheets, { title, subtitle });
  setXlsxHeaders(res, `${baseName}.xlsx`);
  res.send(buffer);
}
