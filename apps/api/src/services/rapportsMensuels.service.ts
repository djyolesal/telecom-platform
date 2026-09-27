import { prisma } from '../config/database';
import { logger } from '../utils/logger';
import { uploadBuffer, deleteObject } from './storage.service';
import { construireRapportActivite } from '../controllers/maintenances.controller';

/** Mois précédent au format AAAA-MM (le mois que l'on archive le 1er). */
export function moisPrecedent(reference = new Date()): string {
  const d = new Date(reference.getFullYear(), reference.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Génère le rapport d'un couple (lot × prestataire) pour un mois et le PUBLIE
 * sur la plateforme, avec sa fiche de validation.
 *
 * Régénérer REMPLACE : un mois n'a qu'un rapport, et l'ancien fichier est
 * effacé du stockage. Deux versions que personne ne saurait départager
 * vaudraient moins que pas d'archive du tout.
 */
export async function archiverRapport(
  mois: string,
  lotId: string,
  prestataireId: string,
  contrat: 'PASSIF' | 'SOLAIRE',
  userId: string | null = null,
): Promise<{ id: string; octets: number } | null> {
  const rapport = await construireRapportActivite(userId, {
    mois, lot_id: lotId, prestataire_id: prestataireId, contrat: contrat === 'SOLAIRE' ? 'SOLAIRE' : '',
  }).catch((e) => {
    // « Aucune intervention » n'est pas une erreur : un lot sans activité ce
    // mois-là n'a rien à publier. Le reste est journalisé et laisse passer les
    // autres lots - un échec isolé ne doit pas vider l'archive du mois.
    if ((e as { statusCode?: number }).statusCode === 404) return null;
    logger.warn(`[rapports] ${mois} lot=${lotId} presta=${prestataireId} : ${(e as Error).message}`);
    return null;
  });
  if (!rapport) return null;

  const an = Number(mois.slice(0, 4));
  const mo = Number(mois.slice(5));
  const { genererFicheValidation } = await import('../controllers/taches.controller');
  const fiche = await genererFicheValidation(prestataireId, lotId, an, mo, { format: 'pdf', contrat })
    .catch((e) => {
      logger.warn(`[rapports] fiche non archivée (${mois}, lot ${lotId}) : ${(e as Error).message}`);
      return null;
    });

  const stocke = await uploadBuffer(rapport.pdf, rapport.nomFichier, 'application/pdf', 'rapports');
  const ficheStockee = fiche
    ? await uploadBuffer(fiche.buffer, fiche.nomFichier, 'application/pdf', 'rapports')
    : null;

  const existant = await prisma.rapportMensuel.findUnique({
    where: { mois_lotId_prestataireId_contrat: { mois, lotId, prestataireId, contrat } },
    select: { minioKey: true, ficheMinioKey: true },
  });

  const ligne = await prisma.rapportMensuel.upsert({
    where: { mois_lotId_prestataireId_contrat: { mois, lotId, prestataireId, contrat } },
    create: {
      mois, lotId, prestataireId, contrat, reference: rapport.reference,
      minioKey: stocke.key, ficheMinioKey: ficheStockee?.key ?? null,
      tailleOctets: rapport.pdf.length, nbSites: rapport.sites, nbInterventions: rapport.nb,
      generePar: userId,
    },
    update: {
      reference: rapport.reference, minioKey: stocke.key, ficheMinioKey: ficheStockee?.key ?? null,
      tailleOctets: rapport.pdf.length, nbSites: rapport.sites, nbInterventions: rapport.nb,
      genereLe: new Date(), generePar: userId,
    },
    select: { id: true },
  });

  // L'ancien fichier part APRÈS l'écriture de la nouvelle référence : si la
  // base échoue, l'archive pointe encore sur un fichier qui existe.
  for (const cle of [existant?.minioKey, existant?.ficheMinioKey]) {
    if (cle && cle !== stocke.key && cle !== ficheStockee?.key) {
      await deleteObject(cle).catch(() => { /* déjà parti */ });
    }
  }
  return { id: ligne.id, octets: rapport.pdf.length };
}

/**
 * ARCHIVAGE DE FIN DE MOIS : tous les couples lot × prestataire, passif et
 * solaire. Séquentiel à dessein - chaque rapport télécharge des photos et les
 * met en page ; tout lancer d'un coup saturerait le conteneur.
 */
export async function archiverMoisEcoule(mois = moisPrecedent()): Promise<void> {
  const attributions = await prisma.lotAssignment.findMany({
    where: { prestataire: { isActive: true } },
    select: { lotId: true, prestataireId: true, scope: true, lot: { select: { code: true } } },
    orderBy: [{ lotId: 'asc' }, { prestataireId: 'asc' }],
  });

  let publies = 0;
  let vides = 0;
  for (const a of attributions) {
    const contrat: 'PASSIF' | 'SOLAIRE' = a.scope === 'SOLAIRE' ? 'SOLAIRE' : 'PASSIF';
    if (!['SOLAIRE', 'PASSIVE', 'LES_DEUX'].includes(a.scope)) continue;
    const fait = await archiverRapport(mois, a.lotId, a.prestataireId, contrat).catch((e) => {
      logger.error(`[rapports] échec ${mois} lot ${a.lot.code} :`, e);
      return null;
    });
    if (fait) publies++; else vides++;
  }
  logger.info(`[rapports] ${mois} : ${publies} rapport(s) publié(s), ${vides} couple(s) sans activité.`);
}
