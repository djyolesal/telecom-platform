import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { auditLog } from '../services/audit.service';
import { assertSiteInPerimetre } from '../utils/perimetre';

/**
 * PÉRIODES D'INACCESSIBILITÉ D'UN SITE (route coupée, crue, saison des pluies).
 *
 * Les tâches restent DUES ; une tâche due non réalisée sur un mois où le site a
 * été inaccessible au moins N jours est JUSTIFIÉE (ni retard ni pénalité) et
 * montrée à part dans la conformité, le rapport d'activité et la fiche de
 * validation. Déclarées au cas par cas par un manager ou un admin, lisibles par
 * tous ceux qui voient le site.
 */

const JOUR = /^\d{4}-\d{2}-\d{2}$/;

/** « AAAA-MM-JJ » → Date à minuit UTC (colonne DATE), ou null si vide. */
function lireJour(v: unknown, champ: string): Date | null {
  if (v == null || v === '') return null;
  const s = String(v).slice(0, 10);
  if (!JOUR.test(s)) throw new AppError(`${champ} : date attendue au format AAAA-MM-JJ.`, 422);
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < 2000) throw new AppError(`${champ} : date invalide.`, 422);
  return d;
}

function lireMotif(v: unknown): string {
  const m = String(v ?? '').trim().replace(/\s+/g, ' ');
  if (m.length < 3 || m.length > 300) throw new AppError('Motif requis (3 à 300 caractères) : ex. « Route coupée par la crue du Mono ».', 422);
  return m;
}

/** Refuse une période qui en chevauche une autre du même site (double compte). */
async function verifierChevauchement(siteId: string, debut: Date, fin: Date | null, sauf?: string) {
  const conflit = await prisma.inaccessibiliteSite.findFirst({
    where: {
      siteId,
      ...(sauf ? { id: { not: sauf } } : {}),
      ...(fin ? { debutLe: { lte: fin } } : {}),
      OR: [{ finLe: null }, { finLe: { gte: debut } }],
    },
    select: { debutLe: true, finLe: true },
  });
  if (conflit) {
    const j = (d: Date) => d.toLocaleDateString('fr-FR', { timeZone: 'UTC' });
    throw new AppError(
      `Cette période chevauche celle du ${j(conflit.debutLe)}${conflit.finLe ? ` au ${j(conflit.finLe)}` : ' (non close)'} : prolongez-la plutôt.`, 409);
  }
}

const SELECT = {
  id: true, debutLe: true, finLe: true, motif: true, createdAt: true,
  auteur: { select: { nom: true, prenom: true } },
} as const;

export async function listInaccessibilitesSite(req: Request, res: Response, next: NextFunction) {
  try {
    await assertSiteInPerimetre(req.user!.id, req.params.id);
    const periodes = await prisma.inaccessibiliteSite.findMany({
      where: { siteId: req.params.id }, orderBy: { debutLe: 'desc' }, select: SELECT,
    });
    res.json({ success: true, data: periodes });
  } catch (err) { next(err); }
}

export async function createInaccessibilite(req: Request, res: Response, next: NextFunction) {
  try {
    const site = await prisma.site.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!site) throw new AppError('Site introuvable', 404);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const debut = lireJour(b.debutLe, 'Début');
    if (!debut) throw new AppError('Date de début requise.', 422);
    const fin = lireJour(b.finLe, 'Fin');
    if (fin && fin < debut) throw new AppError('La fin précède le début.', 422);
    const motif = lireMotif(b.motif);
    await verifierChevauchement(site.id, debut, fin);
    const p = await prisma.inaccessibiliteSite.create({
      data: { siteId: site.id, debutLe: debut, finLe: fin, motif, creePar: req.user!.id }, select: SELECT,
    });
    await auditLog(req.user!.id, 'CREATE', 'inaccessibilites_sites', p.id, { siteId: site.id, debut, fin, motif }, req);
    res.status(201).json({ success: true, data: p });
  } catch (err) { next(err); }
}

/** Modifie une période : typiquement la CLORE quand l'accès est rétabli. */
export async function updateInaccessibilite(req: Request, res: Response, next: NextFunction) {
  try {
    const avant = await prisma.inaccessibiliteSite.findUnique({ where: { id: req.params.id } });
    if (!avant) throw new AppError('Période introuvable', 404);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const debut = 'debutLe' in b ? lireJour(b.debutLe, 'Début') : avant.debutLe;
    if (!debut) throw new AppError('Date de début requise.', 422);
    const fin = 'finLe' in b ? lireJour(b.finLe, 'Fin') : avant.finLe;
    if (fin && fin < debut) throw new AppError('La fin précède le début.', 422);
    const motif = 'motif' in b ? lireMotif(b.motif) : avant.motif;
    await verifierChevauchement(avant.siteId, debut, fin, avant.id);
    const p = await prisma.inaccessibiliteSite.update({
      where: { id: avant.id }, data: { debutLe: debut, finLe: fin, motif }, select: SELECT,
    });
    await auditLog(req.user!.id, 'UPDATE', 'inaccessibilites_sites', avant.id, {
      avant: { debut: avant.debutLe, fin: avant.finLe, motif: avant.motif }, apres: { debut, fin, motif },
    }, req);
    res.json({ success: true, data: p });
  } catch (err) { next(err); }
}

/** Supprime une période saisie par erreur (les rapports passés se recalculent sans elle). */
export async function deleteInaccessibilite(req: Request, res: Response, next: NextFunction) {
  try {
    const p = await prisma.inaccessibiliteSite.findUnique({ where: { id: req.params.id } });
    if (!p) throw new AppError('Période introuvable', 404);
    await prisma.inaccessibiliteSite.delete({ where: { id: p.id } });
    await auditLog(req.user!.id, 'DELETE', 'inaccessibilites_sites', p.id, {
      siteId: p.siteId, debut: p.debutLe, fin: p.finLe, motif: p.motif,
    }, req);
    res.json({ success: true });
  } catch (err) { next(err); }
}
