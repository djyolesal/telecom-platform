import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';

/**
 * Un plan de livraison ne reçoit que des sites À CUVE (capacité renseignée) : on
 * ne livre pas de gasoil là où rien ne peut le recevoir.
 *
 * `dejaAuPlan` : les sites déjà dans ce plan restent modifiables. Une cuve
 * effacée de la fiche ne doit pas bloquer un plan en cours de livraison.
 */
export async function exigerSitesACuve(siteIds: string[], dejaAuPlan: string[] = []): Promise<void> {
  const acquis = new Set(dejaAuPlan);
  const nouveaux = siteIds.filter((id) => !acquis.has(id));
  if (!nouveaux.length) return;
  const sites = await prisma.site.findMany({
    where: { id: { in: nouveaux }, cuveVolumeLitres: { gt: 0 } },
    select: { id: true },
  });
  const aCuve = new Set(sites.map((s) => s.id));
  const refuses = nouveaux.filter((id) => !aCuve.has(id));
  if (!refuses.length) return;
  const noms = await prisma.site.findMany({ where: { id: { in: refuses } }, select: { nom: true }, orderBy: { nom: 'asc' } });
  throw new AppError(
    noms.length
      ? `Site sans cuve renseignée : ${noms.map((s) => s.nom).join(', ')}. Retirez-le du plan ou complétez la capacité de la cuve sur sa fiche.`
      : 'Site du plan introuvable.',
    422
  );
}
