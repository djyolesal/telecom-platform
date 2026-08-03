import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { AppError } from '../utils/AppError';
import { sousSemaphoreOcr, verifierPdf, rendreImages, ocrImage, texteNatif } from './ocrCommon';

/**
 * Analyse du PDF d'un bon de commande carburant (modèle Moov Africa) pour
 * PRÉ-REMPLIR le formulaire de création — l'utilisateur vérifie et valide,
 * la machine ne crée jamais le BC seule (les volumes engagent des centaines
 * de millions XOF : l'OCR propose, l'humain dispose).
 *
 * Deux voies :
 *  - PDF natif (couche texte) → `pdftotext -layout`, extraction exacte ;
 *  - scan (cas réel constaté : une image JPEG par page, aucun texte) →
 *    `pdftoppm` puis OCR `tesseract` en français.
 */

export interface VolumeMensuelExtrait { mois: number; volumePrevuLitres: number }

export interface ExtractionBC {
  numero: string | null;
  dateEmission: string | null; // JJ/MM/AAAA tel que lu
  annee: number | null;
  trimestre: number | null;
  volumesMensuels: VolumeMensuelExtrait[];
  totalLitres: number;            // somme des volumes extraits
  totalAnnonceLitres: number | null; // « Achat de N litres » de l'en-tête
  avertissements: string[];
  ocr: boolean;                   // true si le texte vient de l'OCR (scan)
}

const MOIS_INDEX: Record<string, number> = {
  janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6,
  juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
};

const sansAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** « 164 000 », « 164.000 » ou « 164000 » → 164000. */
const litres = (brut: string) => parseInt(brut.replace(/[ . ]/g, ''), 10);

/**
 * Extraction des champs depuis le texte (natif ou OCR). Pure et exportée pour
 * les tests : c'est ici que vivent les règles, pas dans la plomberie binaire.
 */
export function extraireChampsBC(texte: string, ocr: boolean): ExtractionBC {
  const t = texte.replace(/ /g, ' ');
  const avertissements: string[] = [];

  // N° de commande : PO + 9 chiffres sur le modèle Moov (tolère un espace OCR).
  const mNum = t.match(/\bP[O0]\s?(\d{6,12})\b/i);
  const numero = mNum ? `PO${mNum[1]}` : null;
  if (!numero) avertissements.push('Numéro de commande (POxxxxxxxxx) non trouvé — à saisir manuellement.');

  const mDate = t.match(/\bdu\s+(\d{2}\/\d{2}\/\d{4})\b/i) ?? t.match(/\b(\d{2}\/\d{2}\/\d{4})\b/);
  const dateEmission = mDate ? mDate[1] : null;

  // Lignes « ... mois de <Mois> <Année> <QTE> ... » du tableau.
  const volumesParMois = new Map<number, number>();
  const annees = new Map<number, number>();
  for (const ligne of t.split('\n')) {
    const m = sansAccents(ligne).match(/mois\s+d[e']\s*([a-z]+)\s+(\d{4})(.*)$/);
    if (!m) continue;
    const mois = MOIS_INDEX[m[1]];
    if (!mois) continue;
    const annee = parseInt(m[2], 10);
    annees.set(annee, (annees.get(annee) ?? 0) + 1);
    // (?![,\d]) : sans cette borne, « 158 000 670,0000 » (QTE puis prix
    // unitaire) était lu 158 000 670 — le motif reculera jusqu'à « 158 000 ».
    const qte = m[3].match(/(\d{1,3}(?:[ .]\d{3})+|\d{4,7})(?![,\d])/);
    const valeur = qte ? litres(qte[1]) : NaN;
    if (!qte || !Number.isFinite(valeur) || valeur < 100 || valeur > 5_000_000) {
      avertissements.push(`Quantité illisible pour le mois ${m[1]} — à saisir manuellement.`);
      continue;
    }
    if (volumesParMois.has(mois)) avertissements.push(`Le mois ${m[1]} apparaît deux fois — dernière valeur retenue.`);
    volumesParMois.set(mois, valeur);
  }
  const volumesMensuels = [...volumesParMois.entries()]
    .map(([mois, volumePrevuLitres]) => ({ mois, volumePrevuLitres }))
    .sort((a, b) => a.mois - b.mois);
  if (!volumesMensuels.length) {
    avertissements.push('Aucune ligne mensuelle reconnue dans le tableau — volumes à saisir manuellement.');
  }

  // Année : celle des lignes mensuelles (majoritaire), sinon la date, sinon le PO.
  let annee: number | null = null;
  if (annees.size) annee = [...annees.entries()].sort((a, b) => b[1] - a[1])[0][0];
  else if (dateEmission) annee = parseInt(dateEmission.slice(6), 10);
  else if (numero) annee = 2000 + parseInt(numero.slice(2, 4), 10);
  if (annees.size > 1) avertissements.push('Plusieurs années différentes dans le tableau — vérifiez l\'année.');

  // Trimestre : déduit des MOIS du tableau (pas de la date d'émission — un BC
  // du T2 peut être émis en mars). Tous les mois doivent tomber dans le même.
  let trimestre: number | null = null;
  const trimestres = new Set(volumesMensuels.map((v) => Math.ceil(v.mois / 3)));
  if (trimestres.size === 1) trimestre = [...trimestres][0];
  else if (trimestres.size > 1) avertissements.push('Les mois du tableau chevauchent deux trimestres — vérifiez.');

  // Cohérence : « Achat de N litres » de l'en-tête vs somme des lignes.
  const totalLitres = volumesMensuels.reduce((s, v) => s + v.volumePrevuLitres, 0);
  const mTotal = sansAccents(t).match(/(\d{1,3}(?:[ .]\d{3})+|\d{4,9})\s*litres/);
  const totalAnnonceLitres = mTotal ? litres(mTotal[1]) : null;
  if (totalAnnonceLitres != null && volumesMensuels.length && totalAnnonceLitres !== totalLitres) {
    avertissements.push(
      `Incohérence : l'en-tête annonce ${totalAnnonceLitres.toLocaleString('fr-FR')} L mais la somme des mois fait ${totalLitres.toLocaleString('fr-FR')} L — vérifiez chaque volume.`
    );
  } else if (totalAnnonceLitres == null && volumesMensuels.length) {
    // Sans total d'en-tête lisible, aucun recoupement possible : une valeur
    // mensuelle mal lue (« 164 000 » → « 64 000 ») passerait inaperçue.
    avertissements.push('Total « Achat de N litres » non lu : les volumes mensuels ne sont pas recoupables — vérifiez-les un à un.');
  }

  return { numero, dateEmission, annee, trimestre, volumesMensuels, totalLitres, totalAnnonceLitres, avertissements, ocr };
}

/**
 * Texte du PDF : couche texte si elle existe, sinon OCR de la première page.
 * Rendu borné + garde `pdfinfo` + sémaphore de concurrence (cf. ocrCommon).
 */
export async function texteDuPdf(buffer: Buffer): Promise<{ texte: string; ocr: boolean }> {
  const dossier = await mkdtemp(path.join(tmpdir(), 'bc-'));
  try {
    const pdf = path.join(dossier, 'bc.pdf');
    await writeFile(pdf, buffer);
    await verifierPdf(pdf);

    // Voie 1 : couche texte native.
    const natif = await texteNatif(pdf);
    if (natif.trim().length > 60) return { texte: natif, ocr: false };

    // Voie 2 : scan → première page bornée → OCR français.
    const images = await rendreImages(pdf, dossier, 1);
    if (!images.length) throw new AppError('PDF illisible (aucune page convertible).', 422);
    return { texte: await ocrImage(path.join(dossier, images[0])), ocr: true };
  } finally {
    await rm(dossier, { recursive: true, force: true });
  }
}

export async function analyserBonCommandePdf(buffer: Buffer): Promise<ExtractionBC> {
  return sousSemaphoreOcr(async () => {
    const { texte, ocr } = await texteDuPdf(buffer);
    return extraireChampsBC(texte, ocr);
  });
}
