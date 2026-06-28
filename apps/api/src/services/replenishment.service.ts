import { prisma } from '../config/database';
import { env } from '../config/env';
import { calculerStockSite } from '../utils/calculator';

const n = (v: unknown): number => (v == null ? 0 : Number(v));
const DAY = 86_400_000;

export interface SiteForecast {
  siteId: string; code: string; nom: string; region: string;
  latitude: number | null; longitude: number | null;
  capaciteCuve: number | null;
  stockActuel: number;
  consoJour: number;
  consoTheoriqueJour: number;       // attendu selon la config GE
  tendance: 'HAUSSE' | 'STABLE' | 'BAISSE';
  source: 'historique' | 'theorique';
  autonomieJours: number | null;
  dateRupture: string | null;
  dateLivraisonCible: string | null;
  joursAvantLivraison: number | null;
  quantiteRecommandee: number;
  priorite: 'CRITIQUE' | 'URGENT' | 'A_PLANIFIER';
}

export interface Tournee {
  region: string;
  sites: Array<{ siteId: string; code: string; nom: string; quantite: number }>;
  total: number;
  capacite: number;
  distanceKm: number;        // longueur estimée de la tournée (route optimisée)
  tauxRemplissage: number;   // % de la capacité camion utilisée
}

/** Pente d'une régression linéaire simple y = a·x + b (moindres carrés). */
function linregSlope(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den === 0 ? 0 : num / den;
}

/** Distance approx. (km) entre deux points GPS (haversine). */
function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Prévision de réapprovisionnement par site : estime la consommation journalière
 * (historique des relevés, sinon théorique GE), prédit la date de rupture, et
 * recommande une date de livraison + une quantité (remplissage cuve).
 */
export async function forecastSites(opts: { region?: string; horizonJours?: number; all?: boolean } = {}): Promise<SiteForecast[]> {
  const horizon = opts.horizonJours ?? env.APPRO_HORIZON_JOURS;
  const leadSec = env.APPRO_LEAD_TIME_JOURS + env.APPRO_STOCK_SECURITE_JOURS;
  const now = Date.now();
  const fenetre = new Date(now - 120 * DAY); // historique de conso sur 120 j

  const sites = await prisma.site.findMany({
    where: { isActive: true, ...(opts.region ? { region: opts.region } : {}) },
    select: {
      id: true, code: true, nom: true, region: true, latitude: true, longitude: true,
      cuveVolumeLitres: true, powerConfig: true, statutGE: true, puissanceGEkva: true,
    },
  });
  if (!sites.length) return [];
  const ids = sites.map((s) => s.id);

  // Relevés GE de la fenêtre (conso + niveau de cuve), triés par date.
  const releves = await prisma.releveEnergie.findMany({
    where: { siteId: { in: ids }, source: 'GE', dateReleve: { gte: fenetre } },
    select: { siteId: true, dateReleve: true, gasoilConsommeLitres: true, volumeGasoilLitres: true },
    orderBy: { dateReleve: 'asc' },
  });
  const parSite = new Map<string, typeof releves>();
  for (const r of releves) {
    const arr = parSite.get(r.siteId) ?? [];
    arr.push(r);
    parSite.set(r.siteId, arr);
  }

  // Dépotages récents (pour rehausser le stock si postérieurs au dernier relevé).
  const depots = await prisma.depotage.findMany({
    where: { siteId: { in: ids }, dateDepotage: { gte: fenetre } },
    select: { siteId: true, dateDepotage: true, volumeLitres: true },
  });

  const out: SiteForecast[] = [];
  for (const site of sites) {
    const hist = parSite.get(site.id) ?? [];
    const dernier = hist.length ? hist[hist.length - 1] : null;

    // Stock actuel = dernier niveau de cuve + dépotages postérieurs.
    let stockActuel = dernier ? n(dernier.volumeGasoilLitres) : 0;
    if (dernier) {
      for (const d of depots) {
        if (d.siteId === site.id && d.dateDepotage > dernier.dateReleve) stockActuel += n(d.volumeLitres);
      }
    }

    // Consommation théorique (config GE) — référence pour la détection d'anomalie.
    const consoTheoriqueJour = calculerStockSite(site, null).litresMois / 30;

    // Consommation journalière : historique pondéré (EWMA, récent = plus de poids)
    // + tendance par régression linéaire ; sinon repli théorique.
    let consoJour = 0;
    let tendance: 'HAUSSE' | 'STABLE' | 'BAISSE' = 'STABLE';
    let source: 'historique' | 'theorique' = 'theorique';
    const avecConso = hist.filter((r) => r.gasoilConsommeLitres != null);
    if (avecConso.length >= 2) {
      // Débits journaliers par intervalle entre relevés consécutifs.
      const taux: { jour: number; debit: number }[] = [];
      for (let i = 1; i < avecConso.length; i++) {
        const dj = (avecConso[i].dateReleve.getTime() - avecConso[i - 1].dateReleve.getTime()) / DAY;
        if (dj > 0) taux.push({ jour: (avecConso[i].dateReleve.getTime() - avecConso[0].dateReleve.getTime()) / DAY, debit: n(avecConso[i].gasoilConsommeLitres) / dj });
      }
      const positifs = taux.filter((t) => t.debit > 0);
      if (positifs.length >= 1) {
        // EWMA : pondération exponentielle (alpha) du plus ancien au plus récent.
        const alpha = 0.4;
        let ewma = positifs[0].debit;
        for (let i = 1; i < positifs.length; i++) ewma = alpha * positifs[i].debit + (1 - alpha) * ewma;
        consoJour = ewma;
        source = 'historique';
        // Tendance : signe de la pente d'une régression linéaire débit ~ jour.
        if (positifs.length >= 3) {
          const slope = linregSlope(positifs.map((t) => t.jour), positifs.map((t) => t.debit));
          const seuil = ewma * 0.02; // 2 %/jour
          tendance = slope > seuil ? 'HAUSSE' : slope < -seuil ? 'BAISSE' : 'STABLE';
        }
      }
    }
    if (consoJour <= 0) consoJour = consoTheoriqueJour;

    if (consoJour <= 0) continue; // pas de GE / pas de conso → pas concerné

    const autonomieJours = Math.round((stockActuel / consoJour) * 10) / 10;
    const dateRupture = now + autonomieJours * DAY;
    const dateLivraison = dateRupture - leadSec * DAY;
    const joursAvantLivraison = Math.round(((dateLivraison - now) / DAY) * 10) / 10;

    // On ne retient que les sites dus dans l'horizon (sauf scan complet pour anomalies).
    if (!opts.all && autonomieJours > horizon) continue;

    const capacite = site.cuveVolumeLitres != null ? n(site.cuveVolumeLitres) : null;
    const joursJusquaLivraison = Math.max(0, joursAvantLivraison);
    const stockALivraison = Math.max(0, stockActuel - consoJour * joursJusquaLivraison);
    const cible = capacite ?? consoJour * (horizon + leadSec); // remplir la cuve, ou viser l'horizon
    const quantiteRecommandee = Math.max(0, Math.round(cible - stockALivraison));

    const priorite: SiteForecast['priorite'] =
      joursAvantLivraison <= 0 || autonomieJours <= leadSec ? 'CRITIQUE'
      : autonomieJours <= horizon / 2 ? 'URGENT'
      : 'A_PLANIFIER';

    out.push({
      siteId: site.id, code: site.code, nom: site.nom, region: site.region,
      latitude: site.latitude != null ? n(site.latitude) : null,
      longitude: site.longitude != null ? n(site.longitude) : null,
      capaciteCuve: capacite,
      stockActuel: Math.round(stockActuel),
      consoJour: Math.round(consoJour * 10) / 10,
      consoTheoriqueJour: Math.round(consoTheoriqueJour * 10) / 10,
      tendance,
      source,
      autonomieJours,
      dateRupture: new Date(dateRupture).toISOString(),
      dateLivraisonCible: new Date(dateLivraison).toISOString(),
      joursAvantLivraison,
      quantiteRecommandee,
      priorite,
    });
  }

  // Plus urgent d'abord.
  return out.sort((a, b) => (a.joursAvantLivraison ?? 0) - (b.joursAvantLivraison ?? 0));
}

/**
 * Optimisation des tournées (Phase 2) : par région, on minimise le NOMBRE de
 * camions (regroupement capacitaire par balayage angulaire « sweep ») et les
 * KILOMÈTRES (ordre intra-tournée par plus-proche-voisin puis amélioration 2-opt).
 */
export function suggestTournees(forecasts: SiteForecast[], capacite = env.CAMION_CAPACITE_LITRES): Tournee[] {
  const dus = forecasts.filter((f) => f.quantiteRecommandee > 0);
  const parRegion = new Map<string, SiteForecast[]>();
  for (const f of dus) {
    const arr = parRegion.get(f.region) ?? [];
    arr.push(f);
    parRegion.set(f.region, arr);
  }

  const tournees: Tournee[] = [];
  for (const [region, list] of parRegion) {
    const geo = list.filter((f) => f.latitude != null && f.longitude != null);
    const sansGeo = list.filter((f) => f.latitude == null || f.longitude == null);

    // 1) Regroupement capacitaire par balayage angulaire autour du barycentre.
    const loads = sweepCapacitated(geo, capacite);
    // 2) Sites sans coordonnées : placés au mieux (premier camion ayant de la place).
    for (const f of sansGeo) {
      const q = Math.min(f.quantiteRecommandee, capacite);
      const slot = loads.find((l) => l.reduce((s, x) => s + Math.min(x.quantiteRecommandee, capacite), 0) + q <= capacite);
      if (slot) slot.push(f); else loads.push([f]);
    }

    // 3) Pour chaque camion : ordre optimisé + distance.
    for (const load of loads) {
      const ordered = twoOpt(nearestNeighbour(load));
      const total = ordered.reduce((s, f) => s + Math.min(f.quantiteRecommandee, capacite), 0);
      tournees.push({
        region,
        sites: ordered.map((f) => ({ siteId: f.siteId, code: f.code, nom: f.nom, quantite: Math.min(f.quantiteRecommandee, capacite) })),
        total,
        capacite,
        distanceKm: Math.round(pathDistance(ordered) * 10) / 10,
        tauxRemplissage: Math.round((total / capacite) * 100),
      });
    }
  }
  // Tournées les plus remplies / urgentes d'abord.
  return tournees.sort((a, b) => b.tauxRemplissage - a.tauxRemplissage);
}

/** Découpe des sites (avec GPS) en camions ≤ capacité par balayage angulaire (sweep CVRP). */
function sweepCapacitated(sites: SiteForecast[], capacite: number): SiteForecast[][] {
  if (!sites.length) return [];
  const cLat = sites.reduce((s, f) => s + (f.latitude as number), 0) / sites.length;
  const cLng = sites.reduce((s, f) => s + (f.longitude as number), 0) / sites.length;
  const byAngle = [...sites].sort(
    (a, b) => Math.atan2((a.latitude as number) - cLat, (a.longitude as number) - cLng)
      - Math.atan2((b.latitude as number) - cLat, (b.longitude as number) - cLng)
  );
  const loads: SiteForecast[][] = [];
  let cur: SiteForecast[] = [];
  let curTotal = 0;
  for (const f of byAngle) {
    const q = Math.min(f.quantiteRecommandee, capacite);
    if (curTotal + q > capacite && cur.length) { loads.push(cur); cur = []; curTotal = 0; }
    cur.push(f); curTotal += q;
  }
  if (cur.length) loads.push(cur);
  return loads;
}

/** Ordonne un camion par plus-proche-voisin (route ouverte). */
function nearestNeighbour(load: SiteForecast[]): SiteForecast[] {
  const geo = load.filter((f) => f.latitude != null && f.longitude != null);
  const sansGeo = load.filter((f) => f.latitude == null || f.longitude == null);
  if (geo.length <= 2) return [...load];
  const remaining = [...geo];
  const route: SiteForecast[] = [remaining.shift()!];
  while (remaining.length) {
    const last = route[route.length - 1];
    let bestIdx = 0, bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = distanceKm(last.latitude!, last.longitude!, remaining[i].latitude!, remaining[i].longitude!);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    route.push(remaining.splice(bestIdx, 1)[0]);
  }
  return [...route, ...sansGeo];
}

/** Amélioration 2-opt d'une route ouverte (réduit les croisements). */
function twoOpt(route: SiteForecast[]): SiteForecast[] {
  const pts = route.filter((f) => f.latitude != null && f.longitude != null);
  const rest = route.filter((f) => f.latitude == null || f.longitude == null);
  if (pts.length < 4) return route;
  let best = [...pts];
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 50) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const candidate = best.slice(0, i).concat(best.slice(i, k + 1).reverse(), best.slice(k + 1));
        if (pathDistance(candidate) + 1e-6 < pathDistance(best)) { best = candidate; improved = true; }
      }
    }
  }
  return [...best, ...rest];
}

/** Longueur d'une route ouverte (somme des segments consécutifs, en km). */
function pathDistance(route: SiteForecast[]): number {
  let d = 0;
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i], b = route[i + 1];
    if (a.latitude == null || a.longitude == null || b.latitude == null || b.longitude == null) continue;
    d += distanceKm(a.latitude, a.longitude, b.latitude, b.longitude);
  }
  return d;
}
