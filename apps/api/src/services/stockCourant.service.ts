import { prisma } from '../config/database';
import { soldeMouvementsParSite } from './mouvementsCarburant.service';
import { jaugeDepotageCredible, JaugeDepotageLite } from './stocksMensuels.service';

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
 * Règle retenue (partagée avec le job d'alerte et le réapprovisionnement) :
 *   stock = dernière mesure (relevé GE ou jauge après un dépotage crédible)
 *           + Σ dépotages postérieurs
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

/** Un niveau de cuve connu à une date. */
export interface PointStock { date: Date; litres: number }

/**
 * Stock d'UN site à partir de sa dernière MESURE (fonction pure).
 *
 * La mesure de départ est la plus récente entre le dernier relevé GE et la
 * jauge APRÈS livraison d'un dépotage crédible (jaugeDepotageCredible : même
 * règle que les stocks mensuels). Partir du relevé et lui ajouter le volume
 * livré oubliait le gasoil brûlé entre la visite et la livraison : le stock
 * était surestimé d'autant, avec la date de livraison affichée comme une date
 * de mesure. À la même heure, le relevé prime.
 *
 * stock = mesure de départ + Σ dépotages strictement postérieurs.
 * Site sans aucune mesure mais déjà livré : somme de ses dépotages, référence
 * au plus ancien (règle inchangée), `mesure` faux. Ni mesure ni dépotage : null.
 */
export function stockDepuisMesure(
  releve: PointStock | null,
  depotages: JaugeDepotageLite[],
): { litres: number; reference: Date; dernierEvenement: Date; mesure: boolean } | null {
  let ref = releve;
  for (const d of depotages) {
    if (!jaugeDepotageCredible(d)) continue;
    if (!ref || d.date > ref.date) ref = { date: d.date, litres: d.apres! };
  }
  if (!ref) {
    if (!depotages.length) return null;
    let premier = depotages[0].date;
    let dernier = depotages[0].date;
    let litres = 0;
    for (const d of depotages) {
      litres += d.litres;
      if (d.date < premier) premier = d.date;
      if (d.date > dernier) dernier = d.date;
    }
    return { litres, reference: premier, dernierEvenement: dernier, mesure: false };
  }
  let litres = ref.litres;
  let dernier = ref.date;
  for (const d of depotages) {
    if (d.date <= ref.date) continue;
    litres += d.litres;
    if (d.date > dernier) dernier = d.date;
  }
  return { litres, reference: ref.date, dernierEvenement: dernier, mesure: true };
}

/** Dépotage tel que lu en base, converti pour stockDepuisMesure. */
export function depotageLite(d: {
  dateDepotage: Date; volumeLitres: unknown; stockAvantLitres?: unknown; stockApresLitres?: unknown;
}): JaugeDepotageLite {
  return {
    date: d.dateDepotage,
    litres: Number(d.volumeLitres),
    avant: d.stockAvantLitres != null ? Number(d.stockAvantLitres) : null,
    apres: d.stockApresLitres != null ? Number(d.stockApresLitres) : null,
  };
}

/** Stock ET date de l'événement le plus récent qui le fonde, en une passe. */
export async function stockEtDates(): Promise<{ stock: Map<string, number>; dates: Map<string, Date> }> {
  // `distinct` : une ligne par site au lieu de tout l'historique GE.
  const releves = await prisma.releveEnergie.findMany({
    where: { source: 'GE', volumeGasoilLitres: { not: null } },
    orderBy: [{ siteId: 'asc' }, { dateReleve: 'desc' }],
    distinct: ['siteId'],
    select: { siteId: true, volumeGasoilLitres: true, dateReleve: true },
  });
  const releveParSite = new Map<string, PointStock>();
  for (const r of releves) releveParSite.set(r.siteId, { date: r.dateReleve, litres: Number(r.volumeGasoilLitres) });

  // Dépotages postérieurs au relevé de référence. Bornés au plus ancien relevé :
  // charger toute la table depuis la création du parc croîtrait sans fin.
  const plusAncien = [...releveParSite.values()].reduce<Date | null>((min, r) => (!min || r.date < min ? r.date : min), null);
  const depotages = await prisma.depotage.findMany({
    where: plusAncien ? { dateDepotage: { gte: plusAncien } } : {},
    select: { siteId: true, dateDepotage: true, volumeLitres: true, stockAvantLitres: true, stockApresLitres: true },
  });
  const depotsParSite = new Map<string, JaugeDepotageLite[]>();
  for (const d of depotages) {
    const arr = depotsParSite.get(d.siteId) ?? [];
    arr.push(depotageLite(d));
    depotsParSite.set(d.siteId, arr);
  }

  const stock = new Map<string, number>();
  const reference = new Map<string, Date>();
  const dates = new Map<string, Date>();
  for (const siteId of new Set([...releveParSite.keys(), ...depotsParSite.keys()])) {
    const r = stockDepuisMesure(releveParSite.get(siteId) ?? null, depotsParSite.get(siteId) ?? []);
    if (!r) continue;
    stock.set(siteId, r.litres);
    reference.set(siteId, r.reference);
    // La date publiée est celle du dernier ÉVÉNEMENT qui a bougé le stock -
    // relevé, jauge ou dépotage -, pas celle du seul relevé.
    dates.set(siteId, r.dernierEvenement);
  }

  // Transferts et purges postérieurs à la mesure de départ : sans eux, un site
  // vidé au profit d'un autre resterait affiché plein, et un site secouru
  // resterait affiché critique alors qu'il vient d'être servi.
  const solde = await soldeMouvementsParSite(reference);
  for (const [siteId, delta] of solde) {
    stock.set(siteId, (stock.get(siteId) ?? 0) + delta);
  }
  return { stock, dates };
}
