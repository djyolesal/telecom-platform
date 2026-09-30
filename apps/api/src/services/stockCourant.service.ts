import { prisma } from '../config/database';
import { soldeMouvementsParSite } from './mouvementsCarburant.service';

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
 *   stock = dernier relevé GE + Σ dépotages postérieurs
 *           + Σ mouvements postérieurs (transferts entrants − sortants − purges).
 *
 * Un site jamais relevé mais déjà livré est compté sur ses seuls dépotages ; un
 * site sans aucune mesure n'apparaît pas (on ne suppose pas un stock nul).
 */
/**
 * FRAÎCHEUR de la mesure : à quelle date remonte ce qui fonde le stock affiché.
 *
 * Sans elle, un site relevé il y a six mois affiche son niveau de l'époque
 * comme « stock courant », avec une autonomie et une alerte calculées dessus.
 * L'outil ne ment pas sur le chiffre - c'est bien la dernière mesure connue -
 * mais il laisse croire qu'elle est d'aujourd'hui. La date accompagne donc
 * désormais le litrage partout où il est publié.
 */
export async function datesStockParSite(): Promise<Map<string, Date>> {
  const { dates } = await stockEtDates();
  return dates;
}

export async function stockCourantParSite(): Promise<Map<string, number>> {
  const { stock } = await stockEtDates();
  return stock;
}

/** Stock ET date de la mesure la plus récente qui le fonde, en une passe. */
export async function stockEtDates(): Promise<{ stock: Map<string, number>; dates: Map<string, Date> }> {
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

  // Transferts et purges postérieurs au relevé : sans eux, un site vidé au
  // profit d'un autre resterait affiché plein, et un site secouru resterait
  // affiché critique alors qu'il vient d'être servi.
  // Les sites connus par leurs SEULS dépotages (jamais relevés) doivent y
  // figurer aussi : sinon leur purge n'était jamais déduite et leur stock
  // restait surévalué. Leur borne est le PLUS ANCIEN de leurs dépotages —
  // `depotages` n'est pas trié, d'où la comparaison à chaque passage.
  const sitesReleves = new Set(dateRef.keys());
  for (const d of depotages) {
    if (sitesReleves.has(d.siteId)) continue;
    const actuel = dateRef.get(d.siteId);
    if (!actuel || d.dateDepotage < actuel) dateRef.set(d.siteId, d.dateDepotage);
  }
  const solde = await soldeMouvementsParSite(dateRef);
  for (const [siteId, delta] of solde) {
    stock.set(siteId, (stock.get(siteId) ?? 0) + delta);
  }
  // La date publiée est celle du dernier ÉVÉNEMENT qui a bougé le stock -
  // relevé ou dépotage -, pas celle du seul relevé : un site livré hier a bien
  // une information d'hier, même si sa cuve n'a pas été jaugée depuis.
  const dates = new Map<string, Date>();
  for (const [siteId, d] of dateRef) dates.set(siteId, d);
  for (const d of depotages) {
    const vue = dates.get(d.siteId);
    if (!vue || d.dateDepotage > vue) dates.set(d.siteId, d.dateDepotage);
  }
  return { stock, dates };
}
