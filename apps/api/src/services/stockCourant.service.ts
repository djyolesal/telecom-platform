import { prisma } from '../config/database';

/**
 * SOURCE UNIQUE du stock de gasoil par site.
 *
 * Trois vérités coexistaient : le tableau de bord et la page « Stock carburant »
 * ne lisaient que le dernier RELEVÉ, tandis que le job d'alerte de 8 h et le
 * réapprovisionnement prédictif ajoutaient les DÉPOTAGES postérieurs. Un site
 * livré de 4 000 L après son dernier relevé restait donc affiché « CRITIQUE »
 * sur un écran et sortait de la liste sur l'autre — le même matin. Le manager
 * lisait deux chiffres contradictoires et perdait confiance dans l'outil.
 *
 * Règle retenue (celle du job, la plus proche du réel) :
 *   stock = dernier relevé GE + Σ dépotages postérieurs à ce relevé.
 *
 * Un site jamais relevé mais déjà livré est compté sur ses seuls dépotages ; un
 * site sans aucune mesure n'apparaît pas (on ne suppose pas un stock nul).
 */
export async function stockCourantParSite(): Promise<Map<string, number>> {
  // `distinct` : une ligne par site au lieu de tout l'historique GE.
  const releves = await prisma.releveEnergie.findMany({
    where: { source: 'GE', volumeGasoilLitres: { not: null } },
    orderBy: [{ siteId: 'asc' }, { dateReleve: 'desc' }],
    distinct: ['siteId'],
    select: { siteId: true, volumeGasoilLitres: true, dateReleve: true },
  });

  const stock = new Map<string, number>();
  const dateRef = new Map<string, Date>();
  for (const r of releves) {
    stock.set(r.siteId, Number(r.volumeGasoilLitres));
    dateRef.set(r.siteId, r.dateReleve);
  }

  // Dépotages postérieurs au relevé de référence. Bornés au plus ancien relevé :
  // charger toute la table depuis la création du parc croîtrait sans fin.
  const plusAncien = [...dateRef.values()].reduce<Date | null>((min, d) => (!min || d < min ? d : min), null);
  const depotages = await prisma.depotage.findMany({
    where: plusAncien ? { dateDepotage: { gte: plusAncien } } : {},
    select: { siteId: true, dateDepotage: true, volumeLitres: true },
  });

  for (const d of depotages) {
    const ref = dateRef.get(d.siteId);
    // Site jamais relevé (ref absente) : le dépotage constitue la seule mesure.
    if (!ref || d.dateDepotage > ref) {
      stock.set(d.siteId, (stock.get(d.siteId) ?? 0) + Number(d.volumeLitres));
    }
  }
  return stock;
}
