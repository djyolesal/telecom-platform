import { execFile } from 'child_process';
import { promisify } from 'util';
import { readdir } from 'fs/promises';
import path from 'path';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';

const run = promisify(execFile);

/**
 * Socle commun de l'analyse OCR des documents (BC, BL). Trois protections
 * contre un déni de service par le conteneur API (limité à 1 Go), la surface
 * étant ouverte au rôle externe TRANSPORTEUR :
 *
 *  1. `verifierPdf` refuse en amont, via `pdfinfo`, un PDF au nombre de pages
 *     déraisonnable ou aux dimensions démesurées (« pixel-bomb » : une MediaBox
 *     géante rendue à 300 dpi allouait plusieurs Go en 1-2 s, avant tout timeout).
 *  2. Le rendu est BORNÉ (`-r 150 -scale-to 2000`) : un bitmap ne dépasse plus
 *     ~2000 px sur son grand côté quelle que soit la taille déclarée.
 *  3. Un SÉMAPHORE global limite le nombre d'OCR simultanés : quelques scans
 *     concurrents ne peuvent plus saturer CPU/RAM et déclencher l'OOM-kill.
 */

const DPI = 150;
const COTE_MAX_PX = 2000;
export const MAX_PAGES_OCR = 6;
// Un A4 fait 595×842 pt ; on tolère jusqu'à ~A0 (2384×3370) avant de refuser.
const COTE_MAX_PT = 3600;
const CONCURRENCE_MAX = 2;

// ── Sémaphore minimal (file d'attente de jetons) ────────────────────────────
let enCours = 0;
const attente: Array<() => void> = [];

async function acquerir(): Promise<void> {
  if (enCours < CONCURRENCE_MAX) { enCours++; return; }
  await new Promise<void>((resolve) => attente.push(resolve));
  enCours++;
}
function liberer(): void {
  enCours--;
  const suivant = attente.shift();
  if (suivant) suivant();
}

/** Exécute une opération OCR sous le sémaphore de concurrence. */
export async function sousSemaphoreOcr<T>(op: () => Promise<T>): Promise<T> {
  await acquerir();
  try { return await op(); } finally { liberer(); }
}

function estAbsent(e: unknown): boolean {
  return (e as NodeJS.ErrnoException)?.code === 'ENOENT';
}

/**
 * Contrôle `pdfinfo` : nombre de pages et dimensions. Lève une AppError 422/501
 * plutôt que de laisser `pdftoppm` allouer une image démesurée.
 */
export async function verifierPdf(pdfPath: string): Promise<{ pages: number }> {
  let stdout: string;
  try {
    ({ stdout } = await run('pdfinfo', [pdfPath], { timeout: 10_000 }));
  } catch (e) {
    if (estAbsent(e)) throw new AppError("Analyse indisponible : poppler-utils n'est pas installé sur le serveur.", 501);
    throw new AppError('PDF illisible ou corrompu.', 422);
  }
  const pages = parseInt(/Pages:\s+(\d+)/.exec(stdout)?.[1] ?? '0', 10);
  if (!pages) throw new AppError('PDF sans page exploitable.', 422);
  if (pages > MAX_PAGES_OCR) {
    throw new AppError(`Document trop volumineux (${pages} pages, ${MAX_PAGES_OCR} max). Scindez-le.`, 422);
  }
  const m = /Page size:\s+([\d.]+)\s+x\s+([\d.]+)/.exec(stdout);
  if (m) {
    const largeur = parseFloat(m[1]);
    const hauteur = parseFloat(m[2]);
    if (largeur > COTE_MAX_PT || hauteur > COTE_MAX_PT) {
      throw new AppError('Format de page non pris en charge (dimensions hors normes).', 422);
    }
  }
  return { pages };
}

/** Rend jusqu'à `maxPages` pages en JPEG bornées (dossier temporaire fourni). */
export async function rendreImages(pdfPath: string, dossier: string, maxPages = MAX_PAGES_OCR): Promise<string[]> {
  await run(
    'pdftoppm',
    ['-jpeg', '-r', String(DPI), '-scale-to', String(COTE_MAX_PX), '-f', '1', '-l', String(maxPages), pdfPath, path.join(dossier, 'page')],
    { timeout: 60_000 }
  );
  return (await readdir(dossier)).filter((f) => f.startsWith('page') && f.endsWith('.jpg')).sort();
}

/** OCR français d'une image (tesseract). */
export async function ocrImage(imagePath: string): Promise<string> {
  try {
    const { stdout } = await run('tesseract', [imagePath, 'stdout', '-l', 'fra', '--psm', '4'],
      { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  } catch (e) {
    if (estAbsent(e)) throw new AppError("Analyse indisponible : tesseract n'est pas installé sur le serveur.", 501);
    logger.warn('[ocr] tesseract en échec:', e);
    throw new AppError('Échec de la reconnaissance de caractères.', 422);
  }
}

/** Couche texte native d'un PDF (pdftotext), ou chaîne vide si absente. */
export async function texteNatif(pdfPath: string): Promise<string> {
  try {
    const { stdout } = await run('pdftotext', ['-layout', pdfPath, '-'], { timeout: 20_000 });
    return stdout;
  } catch (e) {
    if (estAbsent(e)) throw new AppError("Analyse indisponible : poppler-utils n'est pas installé sur le serveur.", 501);
    logger.warn('[ocr] pdftotext en échec, bascule OCR:', e);
    return '';
  }
}
