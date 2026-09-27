import { Request, Response, NextFunction } from 'express';
import JSZip from 'jszip';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { getObjectBuffer } from '../services/storage.service';
import { auditLog } from '../services/audit.service';
import { archiverRapport, moisPrecedent, archiverMoisEcoule } from '../services/rapportsMensuels.service';

/**
 * Périmètre de lecture des rapports publiés.
 *
 * Un compte rattaché à un PRESTATAIRE ne voit que les siens - il reçoit le
 * document qui l'évalue, il ne le fabrique pas et ne lit pas celui du voisin.
 * Les équipes internes voient tout le parc.
 */
async function filtrePerimetre(userId: string): Promise<Record<string, unknown>> {
  const moi = await prisma.user.findUnique({ where: { id: userId }, select: { prestataireId: true } });
  return moi?.prestataireId ? { prestataireId: moi.prestataireId } : {};
}

/** Liste des rapports publiés, du plus récent au plus ancien. */
export async function listerRapportsMensuels(req: Request, res: Response, next: NextFunction) {
  try {
    const { mois, lot_id, prestataire_id, contrat } = req.query as Record<string, string>;
    const rapports = await prisma.rapportMensuel.findMany({
      where: {
        ...(await filtrePerimetre(req.user!.id)),
        ...(mois ? { mois } : {}),
        ...(lot_id ? { lotId: lot_id } : {}),
        ...(prestataire_id ? { prestataireId: prestataire_id } : {}),
        ...(contrat ? { contrat } : {}),
      },
      select: {
        id: true, mois: true, contrat: true, reference: true, tailleOctets: true,
        nbSites: true, nbInterventions: true, genereLe: true, ficheMinioKey: true,
        lot: { select: { id: true, code: true, nom: true, region: true } },
        prestataire: { select: { id: true, nom: true } },
      },
      // Le dernier mois EN HAUT : c'est celui qu'on vient chercher.
      orderBy: [{ mois: 'desc' }, { genereLe: 'desc' }],
      take: 500,
    });
    res.json({
      success: true,
      data: rapports.map((r) => ({ ...r, avecFiche: !!r.ficheMinioKey, ficheMinioKey: undefined })),
    });
  } catch (err) { next(err); }
}

/**
 * Téléchargement d'un rapport publié : le rapport, sa fiche, ou les DEUX dans
 * une archive (`piece=zip`) - c'est ce qu'on transmet en une fois quand on
 * remet le mois à un prestataire.
 */
export async function telechargerRapportMensuel(req: Request, res: Response, next: NextFunction) {
  try {
    const rapport = await prisma.rapportMensuel.findFirst({
      where: { id: req.params.id, ...(await filtrePerimetre(req.user!.id)) },
      select: {
        minioKey: true, ficheMinioKey: true, mois: true, contrat: true,
        lot: { select: { code: true } }, prestataire: { select: { nom: true } },
      },
    });
    if (!rapport) throw new AppError('Rapport introuvable.', 404);

    const piece = String(req.query.piece ?? 'rapport');
    const morceau = (v: string) => v.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
    const suffixe = [
      rapport.contrat === 'SOLAIRE' ? 'solaire' : null,
      morceau(rapport.prestataire.nom), morceau(rapport.lot.code), rapport.mois,
    ].filter(Boolean).join('-');
    const lire = async (cle: string) => {
      const buf = await getObjectBuffer(cle).catch(() => null);
      if (!buf) throw new AppError('Le fichier archivé est introuvable dans le stockage.', 404);
      return buf;
    };

    if (piece === 'zip') {
      // Les deux pièces d'un même mois, sous leurs propres noms : c'est le
      // paquet qu'on transmet au prestataire, et il reste lisible une fois
      // décompressé n'importe où.
      const zip = new JSZip();
      zip.file(`rapport-activite-${suffixe}.pdf`, await lire(rapport.minioKey));
      if (rapport.ficheMinioKey) zip.file(`fiche-validation-${suffixe}.pdf`, await lire(rapport.ficheMinioKey));
      const archive = await zip.generateAsync({ type: 'nodebuffer' });
      await auditLog(req.user!.id, 'EXPORT', 'rapports_mensuels', req.params.id,
        { piece: 'zip', mois: rapport.mois }, req);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="rapport-mensuel-${suffixe}.zip"`);
      res.send(archive);
      return;
    }

    const fiche = piece === 'fiche';
    const cle = fiche ? rapport.ficheMinioKey : rapport.minioKey;
    if (!cle) throw new AppError("La fiche de validation n'a pas été archivée avec ce rapport.", 404);
    const pdf = await lire(cle);

    await auditLog(req.user!.id, 'EXPORT', 'rapports_mensuels', req.params.id,
      { piece: fiche ? 'fiche' : 'rapport', mois: rapport.mois }, req);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fiche ? 'fiche-validation' : 'rapport-activite'}-${suffixe}.pdf"`);
    res.send(pdf);
  } catch (err) { next(err); }
}

/**
 * (Re)publication d'un mois, à la demande d'un administrateur : correction
 * d'un oubli, ou reprise après qu'une intervention a été invalidée.
 */
export async function publierRapportMensuel(req: Request, res: Response, next: NextFunction) {
  try {
    const { mois, lot_id, prestataire_id, contrat } = req.body as Record<string, string>;
    if (!/^\d{4}-\d{2}$/.test(mois ?? '')) throw new AppError('Mois invalide (format AAAA-MM).', 422);

    if (lot_id && prestataire_id) {
      const fait = await archiverRapport(
        mois, lot_id, prestataire_id, contrat === 'SOLAIRE' ? 'SOLAIRE' : 'PASSIF', req.user!.id,
      );
      if (!fait) throw new AppError('Aucune activité à publier pour ce lot sur ce mois.', 404);
      await auditLog(req.user!.id, 'CREATE', 'rapports_mensuels', fait.id, { mois, lot_id, prestataire_id }, req);
      res.json({ success: true, data: { id: fait.id, octets: fait.octets } });
      return;
    }
    // Tout le parc : long (photos à charger et mettre en page), on répond
    // tout de suite et le travail continue en tâche de fond.
    void archiverMoisEcoule(mois);
    await auditLog(req.user!.id, 'CREATE', 'rapports_mensuels', undefined, { mois, parc: true }, req);
    res.json({ success: true, data: { mois, lance: true } });
  } catch (err) { next(err); }
}

/** Mois proposé par défaut à la publication : celui qui vient de s'achever. */
export function moisParDefaut(_req: Request, res: Response) {
  res.json({ success: true, data: { mois: moisPrecedent() } });
}
