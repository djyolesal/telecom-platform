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
  // Deux découpages de parc coexistent : lots passifs/actifs (lot) et lots
  // SOLAIRES (lotSolaire) — le prestataire voit les sites de ses lots, quel
  // que soit le contrat qui les lui confie.
  return me?.prestataireId
    ? {
        OR: [
          { lot: { assignments: { some: { prestataireId: me.prestataireId } } } },
          { lotSolaire: { assignments: { some: { prestataireId: me.prestataireId } } } },
        ],
      }
    : {};
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

/**
 * true si le compte est rattaché à un prestataire externe : les COÛTS internes
 * (FCFA agrégés, prix négociés) lui sont masqués — les litres/kWh suffisent à
 * l'exploitation, la structure de coûts de l'opérateur ne le regarde pas.
 */
/**
 * Techniciens ASSIGNABLES pour un site : les internes + ceux des prestataires
 * titulaires du lot (annotés société + scope contractuel) ; un appelant
 * prestataire ne voit que les siens. Partagé incidents / maintenances.
 */
export async function techniciensAssignables(appelantId: string, siteId: string) {
  const [site, moi] = await Promise.all([
    prisma.site.findUnique({
      where: { id: siteId },
      // Les DEUX découpages de parc, comme sitePerimetre : lot passif/actif ET
      // lot solaire. Ne lire que le premier ne proposait AUCUN prestataire
      // pour un site couvert par le seul contrat solaire — et masquait le
      // titulaire solaire partout ailleurs.
      select: {
        lot: { select: { assignments: { select: { prestataireId: true, scope: true } } } },
        lotSolaire: { select: { assignments: { select: { prestataireId: true, scope: true } } } },
      },
    }),
    prisma.user.findUnique({ where: { id: appelantId }, select: { prestataireId: true } }),
  ]);
  const scopesDe = new Map<string, string[]>();
  for (const a of [...(site?.lot?.assignments ?? []), ...(site?.lotSolaire?.assignments ?? [])]) {
    const l = scopesDe.get(a.prestataireId) ?? [];
    if (!l.includes(a.scope)) l.push(a.scope);
    scopesDe.set(a.prestataireId, l);
  }
  const techs = await prisma.user.findMany({
    where: {
      role: 'TECHNICIEN', isActive: true,
      ...(moi?.prestataireId
        ? { prestataireId: moi.prestataireId }
        : { OR: [{ prestataireId: null }, { prestataireId: { in: [...scopesDe.keys()] } }] }),
    },
    select: { id: true, nom: true, prenom: true, prestataireId: true, prestataire: { select: { nom: true } } },
    orderBy: [{ prestataireId: 'asc' }, { nom: 'asc' }],
  });
  return techs.map((t) => ({
    id: t.id, nom: t.nom, prenom: t.prenom,
    societe: t.prestataire?.nom ?? 'Interne',
    scopes: t.prestataireId ? (scopesDe.get(t.prestataireId) ?? []) : [],
  }));
}

/**
 * Garde d'affectation : le technicien visé doit être actif et couvrir le site
 * (interne, ou prestataire du lot) ; un appelant prestataire ne peut affecter
 * que dans SA société. Ne s'applique pas à l'auto-affectation.
 */
export async function assertTechnicienAssignable(appelantId: string, technicienId: string, siteId: string): Promise<void> {
  if (technicienId === appelantId) return;
  const [tech, moi] = await Promise.all([
    prisma.user.findUnique({ where: { id: technicienId }, select: { isActive: true, prestataireId: true } }),
    prisma.user.findUnique({ where: { id: appelantId }, select: { prestataireId: true } }),
  ]);
  if (!tech || !tech.isActive) throw new AppError('Technicien introuvable ou inactif', 400);
  if (moi?.prestataireId && tech.prestataireId !== moi.prestataireId) {
    throw new AppError('Affectation limitée aux techniciens de votre société', 403);
  }
  await assertSiteInPerimetre(technicienId, siteId);
}

export async function estPrestataire(userId: string): Promise<boolean> {
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { prestataireId: true } });
  return !!me?.prestataireId;
}
