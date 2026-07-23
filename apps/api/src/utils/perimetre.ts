import { prisma } from '../config/database';
import { AppError } from './AppError';

/**
 * Périmètre PRESTATAIRE : un utilisateur rattaché à un prestataire (technicien
 * comme superviseur) ne voit que les sites des lots attribués à sa société —
 * même règle partout (listes, carte, rapports, sous-ressources d'un site).
 * Un interne (sans prestataireId) n'est jamais restreint.
 */

/** Fragment Prisma à appliquer sur le modèle SITE ({} si utilisateur interne). */
export async function sitePerimetre(userId: string): Promise<Record<string, unknown>> {
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { prestataireId: true } });
  return me?.prestataireId ? { lot: { assignments: { some: { prestataireId: me.prestataireId } } } } : {};
}

/** true si le périmètre est restreint (utilisateur rattaché à un prestataire). */
export function isRestreint(p: Record<string, unknown>): boolean {
  return Object.keys(p).length > 0;
}

/**
 * Ids des sites visibles par l'utilisateur, ou null si tout le parc (interne).
 * Pour post-filtrer les résultats d'un service qui ne prend pas de filtre site.
 */
export async function allowedSiteIds(userId: string): Promise<Set<string> | null> {
  const p = await sitePerimetre(userId);
  if (!isRestreint(p)) return null;
  const sites = await prisma.site.findMany({ where: { ...p }, select: { id: true } });
  return new Set(sites.map((s) => s.id));
}

/** 404 si le site est hors périmètre (même réponse qu'un site inexistant : pas d'énumération). */
export async function assertSiteInPerimetre(userId: string, siteId: string): Promise<void> {
  const p = await sitePerimetre(userId);
  if (!isRestreint(p)) return;
  const ok = await prisma.site.findFirst({ where: { id: siteId, ...p }, select: { id: true } });
  if (!ok) throw new AppError('Site introuvable', 404);
}
