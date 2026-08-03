import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, rm, writeFile, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';

const run = promisify(execFile);

/**
 * Analyse d'un bon de livraison TotalEnergies (modèle Moov Africa) pour
 * pré-remplir le formulaire BL — depuis un PDF (web) ou une PHOTO prise par le
 * transporteur (mobile). Un PDF peut contenir PLUSIEURS BL (une page chacun) :
 * chaque page exploitable produit une extraction.
 *
 * Champs du document réel :
 *   Référence / Date : 3030729534 / 07.08.2025   → n° BL + date de traitement
 *   Votre N° Client : 116129                     → n° client
 *   Réf. cde. Client : BC N°PO250300014          → n° du bon de commande
 *   TG 0688 AH (colonne Description)             → immatriculation camion
 *   Quantité 15.000,000 L                        → volume chargé
 */

export interface ExtractionBL {
  page: number;
  numeroBL: string | null;
  numeroClient: string | null;
  bcNumero: string | null;
  dateBL: string | null; // JJ/MM/AAAA
  immatriculation: string | null;
  volumeChargeLitres: number | null;
  avertissements: string[];
}

/** Normalise « 15.000,000 » / « 19 000,000 » → litres entiers. */
function volumeDepuis(brut: string): number {
  return parseInt(brut.split(',')[0].replace(/[. ]/g, ''), 10);
}

export function extraireChampsBL(texte: string, page: number): ExtractionBL {
  const t = texte.replace(/ /g, ' ');
  const avertissements: string[] = [];

  // « Référence / Date : 3030729534 / 07.08.2025 » — n° BL et sa date.
  const mRef = t.match(/R[ée]f[ée]rence\s*\/?\s*Date\s*:?\s*(\d{8,12})\s*\/\s*(\d{2}[./]\d{2}[./]\d{4})/i);
  const numeroBL = mRef ? mRef[1] : null;
  const dateBL = mRef ? mRef[2].replace(/\./g, '/') : null;
  if (!numeroBL) avertissements.push('N° de BL (ligne « Référence / Date ») non trouvé — à saisir manuellement.');

  const mClient = t.match(/N[°ºo]\s*Client\s*:?\s*(\d{4,10})/i);
  const numeroClient = mClient ? mClient[1] : null;

  // « Réf. cde. Client / Date : BC N°PO250300014 » — rattache le BL à son BC.
  const mBc = t.match(/BC\s*N[°ºo]?\s*(P[O0]\s?\d{6,12})/i);
  const bcNumero = mBc ? `PO${mBc[1].replace(/^P[O0]\s?/i, '')}` : null;
  if (!bcNumero) avertissements.push('N° du bon de commande (BC N°POxxxxxxxxx) non trouvé — sélectionnez-le manuellement.');

  // Plaque togolaise : TG + 4 chiffres + 2 lettres (dans la colonne Description).
  const mImmat = t.match(/\bTG\s*(\d{4})\s*([A-Z]{2})\b/);
  const immatriculation = mImmat ? `TG ${mImmat[1]} ${mImmat[2]}` : null;
  if (!immatriculation) avertissements.push('Immatriculation du camion (TG xxxx XX) non trouvée — à saisir manuellement.');

  // Quantité « 15.000,000 » : milliers au point, trois décimales à la virgule.
  const mVol = t.match(/(\d{1,3}(?:[. ]\d{3})*),\d{3}\b/);
  let volumeChargeLitres: number | null = null;
  if (mVol) {
    const v = volumeDepuis(mVol[0]);
    // Un camion-citerne livre entre quelques centaines et ~60 000 L.
    if (Number.isFinite(v) && v >= 500 && v <= 60_000) volumeChargeLitres = v;
  }
  if (volumeChargeLitres == null) avertissements.push('Volume chargé (colonne Quantité) illisible — à saisir manuellement.');

  return { page, numeroBL, numeroClient, bcNumero, dateBL, immatriculation, volumeChargeLitres, avertissements };
}

/** Une page est exploitable si au moins un champ clef en est sorti. */
function exploitable(e: ExtractionBL): boolean {
  return !!(e.numeroBL || e.volumeChargeLitres || e.immatriculation || e.bcNumero);
}

const MAX_PAGES = 8;

async function ocr(image: string): Promise<string> {
  try {
    const { stdout } = await run('tesseract', [image, 'stdout', '-l', 'fra', '--psm', '4'],
      { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new AppError("Analyse indisponible : tesseract n'est pas installé sur le serveur.", 501);
    }
    throw e;
  }
}

/**
 * PDF (multi-pages, natif ou scan) ou image (photo du transporteur) →
 * une extraction par page exploitable.
 */
export async function analyserBonLivraisonDocument(
  buffer: Buffer,
  mimetype: string
): Promise<{ documents: ExtractionBL[]; ocrUtilise: boolean; pagesIgnorees: number }> {
  const dossier = await mkdtemp(path.join(tmpdir(), 'bl-'));
  try {
    // Photo directe (mobile) : OCR immédiat.
    if (mimetype.startsWith('image/')) {
      const img = path.join(dossier, 'photo');
      await writeFile(img, buffer);
      const doc = extraireChampsBL(await ocr(img), 1);
      if (!exploitable(doc)) throw new AppError('Photo illisible : rapprochez-vous du document, évitez reflets et flou, puis reprenez la photo.', 422);
      return { documents: [doc], ocrUtilise: true, pagesIgnorees: 0 };
    }

    const pdf = path.join(dossier, 'bl.pdf');
    await writeFile(pdf, buffer);

    // Voie 1 : couche texte native — pdftotext sépare les pages par \f.
    try {
      const { stdout } = await run('pdftotext', ['-layout', pdf, '-'], { timeout: 20_000 });
      if (stdout.trim().length > 60) {
        const pages = stdout.split('\f');
        const docs = pages.map((p, i) => extraireChampsBL(p, i + 1)).filter(exploitable);
        if (docs.length) return { documents: docs, ocrUtilise: false, pagesIgnorees: pages.length - docs.length };
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new AppError("Analyse indisponible : poppler-utils n'est pas installé sur le serveur.", 501);
      }
      logger.warn('[bl-pdf] pdftotext en échec, bascule OCR:', e);
    }

    // Voie 2 : scan → une image par page (bornées : un lot de BL reste court).
    await run('pdftoppm', ['-jpeg', '-r', '300', '-f', '1', '-l', String(MAX_PAGES), pdf, path.join(dossier, 'page')], { timeout: 60_000 });
    const images = (await readdir(dossier)).filter((f) => f.startsWith('page') && f.endsWith('.jpg')).sort();
    if (!images.length) throw new AppError('PDF illisible (aucune page convertible).', 422);
    const docs: ExtractionBL[] = [];
    let ignorees = 0;
    for (const [i, img] of images.entries()) {
      const doc = extraireChampsBL(await ocr(path.join(dossier, img)), i + 1);
      if (exploitable(doc)) docs.push(doc);
      else ignorees++;
    }
    if (!docs.length) throw new AppError('Aucun bon de livraison reconnu dans ce document.', 422);
    return { documents: docs, ocrUtilise: true, pagesIgnorees: ignorees };
  } finally {
    await rm(dossier, { recursive: true, force: true });
  }
}
