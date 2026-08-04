import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';

const n = (v: unknown): number => (v == null ? 0 : Number(v));

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Effet des mouvements de carburant sur le stock d'un site.
 *
 * Le SENS ne vient jamais du signe du volume (toujours positif en base, garanti
 * par une contrainte) mais du TYPE : sans cette règle, un signe inversé à la
 * saisie fausserait tous les cumuls sans rien déclencher.
 *
 *   TRANSFERT_SORTIE → −  (le gasoil quitte le site)
 *   TRANSFERT_ENTREE → +  (il arrive sur l'autre site)
 *   PURGE            → −  (retiré de la cuve, jamais brûlé par le GE)
 *   AVOIR_FOURNISSEUR→  0 côté site (il ne porte pas de site : il crédite un BC)
 */
export function signeMouvement(type: string): -1 | 0 | 1 {
  if (type === 'TRANSFERT_ENTREE') return 1;
  if (type === 'TRANSFERT_SORTIE' || type === 'PURGE') return -1;
  return 0;
}

/**
 * Solde net des mouvements d'un site sur un intervalle ]debut, fin].
 *
 * Utilisé par la réconciliation d'un dépotage : la « consommation » y est
 * déduite de la baisse de cuve entre deux dépotages. Une purge ou un transfert
 * survenu entre les deux fait baisser la cuve SANS consommation — sans cette
 * correction, l'écart partait en surconsommation, c'est-à-dire en signal de vol
 * sur un site dont le carburant a simplement été déplacé.
 */
export async function soldeMouvementsSite(
  siteId: string,
  debut: Date | null,
  fin: Date,
  db: Db = prisma
): Promise<number> {
  const mvts = await db.mouvementCarburant.findMany({
    where: {
      siteId,
      dateMouvement: { ...(debut ? { gt: debut } : {}), lte: fin },
      type: { in: ['TRANSFERT_SORTIE', 'TRANSFERT_ENTREE', 'PURGE'] },
    },
    select: { type: true, volumeLitres: true },
  });
  return mvts.reduce((s, m) => s + signeMouvement(m.type) * n(m.volumeLitres), 0);
}

/** Solde net par site depuis une date de référence propre à chaque site. */
export async function soldeMouvementsParSite(
  reference: Map<string, Date>,
  db: Db = prisma
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!reference.size) return out;

  // Borné au plus ancien relevé de référence : charger toute la table depuis la
  // création du parc croîtrait sans fin.
  const plusAncien = [...reference.values()].reduce((min, d) => (d < min ? d : min));
  const mvts = await db.mouvementCarburant.findMany({
    where: {
      siteId: { in: [...reference.keys()] },
      dateMouvement: { gte: plusAncien },
      type: { in: ['TRANSFERT_SORTIE', 'TRANSFERT_ENTREE', 'PURGE'] },
    },
    select: { siteId: true, type: true, volumeLitres: true, dateMouvement: true },
  });

  for (const m of mvts) {
    if (!m.siteId) continue;
    const ref = reference.get(m.siteId);
    if (!ref || m.dateMouvement <= ref) continue;
    out.set(m.siteId, (out.get(m.siteId) ?? 0) + signeMouvement(m.type) * n(m.volumeLitres));
  }
  return out;
}

/** Volume repris par le fournisseur sur un bon de commande (avoirs). */
export async function avoirsBonCommande(bonCommandeId: string, db: Db = prisma): Promise<number> {
  const r = await db.mouvementCarburant.aggregate({
    where: { bonCommandeId, type: 'AVOIR_FOURNISSEUR' },
    _sum: { volumeLitres: true },
  });
  return n(r._sum.volumeLitres);
}
