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
 * Le CODE du site est une clé de référentiel : il désigne le site dans la base,
 * dans les imports et dans les rapprochements. Il n'a d'usage que pour qui
 * administre la plateforme ; sur un document qui circule (plan de tournée,
 * bilan transmis, rapport de conformité), il n'apprend rien au lecteur et
 * expose la nomenclature interne. Les exports le réservent donc à l'ADMIN.
 *
 * Le filtre est posé ICI, au point de passage de tous les exports tabulaires,
 * et non dans chaque contrôleur : un export ajouté demain hérite de la règle
 * sans que personne ait à y penser.
 *
 * Conséquence pour qui ajoute une colonne : une colonne « Code » ou de clé
 * `code`/`siteCode` est comprise comme le code d'un SITE et disparaît hors
 * administration. Un code d'autre nature (anomalie, référentiel…) doit porter
 * une clé explicite - `codeAnomalie`, `codeTache` - pour rester visible.
 */
export function estColonneCodeSite(c: ExcelColumn): boolean {
  return c.header.trim().toLowerCase() === 'code' || c.key === 'code' || c.key === 'siteCode';
}

/** Colonnes visibles pour ce rôle : tout sauf le code du site hors ADMIN. */
export function colonnesSelonRole(columns: ExcelColumn[], role?: string): ExcelColumn[] {
  if (role === 'ADMIN') return columns;
  return columns.filter((c) => !estColonneCodeSite(c));
}

/** Idem, appliqué à chaque feuille d'un export multi-feuilles. */
export function feuillesSelonRole(sheets: TabularSheet[], role?: string): TabularSheet[] {
  if (role === 'ADMIN') return sheets;
  return sheets.map((s) => {
    const columns = colonnesSelonRole(s.columns, role);
    return columns.length === s.columns.length ? s : { ...s, columns };
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
  // Avant tout le reste : le code du site sort des colonnes hors ADMIN. Avant,
  // car le catalogue « ?colonnes=? » ne doit pas proposer une colonne que
  // l'export refusera ensuite d'écrire.
  const permises = feuillesSelonRole(sheets, res.req?.user?.role);
  if (colonnes === '?') {
    res.json({
      success: true,
      data: permises.map((s) => ({ feuille: s.name, colonnes: s.columns.map((c) => ({ key: c.key, header: c.header })) })),
    });
    return;
  }
  const finalSheets = filtrerColonnes(permises, colonnes);

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
