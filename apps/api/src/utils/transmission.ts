import { prisma } from '../config/database';
import { AppError } from './AppError';

/**
 * Topologie de transmission : chaque site peut dépendre d'un site AMONT
 * (parentTransmissionId). Une coupure amont impacte tout l'AVAL (descendants).
 */

/** Descendants (récursifs) d'un site dans l'arbre de transmission. */
export async function descendantsTransmission(siteId: string): Promise<Array<{ id: string; nom: string }>> {
  const sites = await prisma.site.findMany({
    where: { isActive: true },
    select: { id: true, nom: true, parentTransmissionId: true },
  });
  const enfants = new Map<string, Array<{ id: string; nom: string }>>();
  for (const s of sites) {
    if (!s.parentTransmissionId) continue;
    const liste = enfants.get(s.parentTransmissionId) ?? [];
    liste.push({ id: s.id, nom: s.nom });
    enfants.set(s.parentTransmissionId, liste);
  }
  const resultat: Array<{ id: string; nom: string }> = [];
  const vus = new Set<string>([siteId]); // protège d'un cycle résiduel en base
  const file = [siteId];
  while (file.length) {
    const courant = file.shift()!;
    for (const e of enfants.get(courant) ?? []) {
      if (vus.has(e.id)) continue;
      vus.add(e.id);
      resultat.push(e);
      file.push(e.id);
    }
  }
  return resultat;
}

/**
 * Refuse un parent qui créerait un cycle (le parent — ou un de ses amonts —
 * est le site lui-même). Remonte la chaîne avec une borne de sécurité.
 */
export async function assertSansCycle(siteId: string, parentId: string): Promise<void> {
  if (parentId === siteId) throw new AppError('Un site ne peut pas être son propre parent de transmission', 400);
  let courant: string | null = parentId;
  for (let i = 0; i < 100 && courant; i++) {
    const parent: { parentTransmissionId: string | null } | null = await prisma.site.findUnique({
      where: { id: courant },
      select: { parentTransmissionId: true },
    });
    if (!parent) throw new AppError('Site parent de transmission introuvable', 400);
    courant = parent.parentTransmissionId;
    if (courant === siteId) {
      throw new AppError('Cycle de transmission : ce parent dépend déjà de ce site (directement ou via sa chaîne)', 400);
    }
  }
}
