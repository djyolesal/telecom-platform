import { prisma } from '../config/database';
import { env } from '../config/env';
import { calculerStockSite, litresMoisGE, litresParHeureGE } from '../utils/calculator';
import { getNum, geParams } from './settings.service';
import { memo } from '../utils/memo';

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
  // horametre : débit L/h réel × heures de marche mesurées (compteur horaire) —
  // le plus fiable pour un GE secours. historique : EWMA des litres consommés.
  // regional : heures de coupure médianes de la région. theorique : formule kVA.
  source: 'horametre' | 'historique' | 'regional' | 'theorique';
  derniereMesure: string | null;    // date du dernier relevé de cuve (ISO), ou null
  heuresGEJour: number | null;       // temps de marche estimé du GE (h/jour)
  autonomieJours: number | null;
  dateRupture: string | null;
  dateLivraisonCible: string | null;
  joursAvantLivraison: number | null;
  quantiteRecommandee: number;
  priorite: 'CRITIQUE' | 'URGENT' | 'A_PLANIFIER';
}

export interface Tournee {
  region: string;
  // passage/nbPassages : un site dont le besoin dépasse un camion est livré en
  // plusieurs fois (ex. passage 1/2) — plus de troncage silencieux du surplus.
  sites: Array<{ siteId: string; code: string; nom: string; quantite: number; passage?: number; nbPassages?: number }>;
  total: number;
  capacite: number;
  distanceKm: number;        // longueur estimée de la tournée (route optimisée)
  tauxRemplissage: number;   // % de la capacité camion utilisée
}

// Demande unitaire ≤ capacité camion (part d'un site, avec son n° de passage).
type Demande = SiteForecast & { _part: number; _passage: number; _nbPassages: number };

/**
 * Découpe chaque besoin en demandes livrables par UN camion : un site nécessitant
 * plus que la capacité génère plusieurs demandes (ex. 15 000 L / camion 10 000 →
 * 10 000 + 5 000). Le surplus n'est plus perdu — il part sur un autre passage.
 */
function explodeDemandes(forecasts: SiteForecast[], capacite: number): Demande[] {
  const out: Demande[] = [];
  for (const f of forecasts) {
    if (f.quantiteRecommandee <= 0) continue;
    const nb = Math.max(1, Math.ceil(f.quantiteRecommandee / capacite));
    let reste = f.quantiteRecommandee;
    for (let i = 0; i < nb; i++) {
      const part = Math.min(reste, capacite);
      reste -= part;
      out.push({ ...f, quantiteRecommandee: part, _part: part, _passage: i + 1, _nbPassages: nb });
    }
  }
  return out;
}

// ── Estimation de la consommation journalière ────────────────────────────────
// Pour un GE secours, la conso dépend de DEUX phénomènes indépendants : le débit
// du moteur (L/h, propre au GE) et le temps de coupure CEET (h/j, propre au site
// et à la saison). On les estime séparément sur les données réelles au lieu de
// supposer 8 h/j et un facteur de charge kVA forfaitaires.

/** Relevé GE minimal pour l'estimation (une ligne = un relevé d'un groupe). */
export interface ReleveConsoLite {
  date: Date;
  groupeId: string | null;
  conso: number | null;   // gasoilConsommeLitres depuis le relevé précédent
  heures: number | null;  // heuresFonctGE déclarées depuis le relevé précédent
  index: number | null;   // indexHeuresGE : compteur horaire cumulatif du GE
}

export interface EstimationConso {
  consoJour: number;
  source: SiteForecast['source'];
  tendance: SiteForecast['tendance'];
  heuresJour: number | null;     // h/j de marche retenues (mesurées ou régionales)
  tauxHoraireLh: number | null;  // débit L/h retenu (réel si mesurable)
}

const EWMA_ALPHA = 0.4;

/** Moyenne pondérée exponentielle, du plus ancien au plus récent. */
function ewmaOf(vals: number[]): number {
  let e = vals[0];
  for (let i = 1; i < vals.length; i++) e = EWMA_ALPHA * vals[i] + (1 - EWMA_ALPHA) * e;
  return e;
}

/** Médiane (null si vide). */
export function mediane(vals: number[]): number | null {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Heures de marche par jour d'après le COMPTEUR HORAIRE : Δindex/Δjours entre
 * relevés consécutifs, EWMA par groupe, sommé sur les groupes du site (le
 * compteur ne ment pas, même quand les litres déclarés sont approximatifs).
 */
export function heuresJourDepuisIndex(releves: ReleveConsoLite[]): number | null {
  const parGroupe = new Map<string, { t: number; index: number }[]>();
  for (const r of releves) {
    if (r.index == null) continue;
    const k = r.groupeId ?? '_';
    const arr = parGroupe.get(k) ?? [];
    arr.push({ t: r.date.getTime(), index: Number(r.index) });
    parGroupe.set(k, arr);
  }
  let total = 0;
  let vu = false;
  for (const pts of parGroupe.values()) {
    pts.sort((a, b) => a.t - b.t);
    const debits: number[] = [];
    for (let i = 1; i < pts.length; i++) {
      const dj = (pts[i].t - pts[i - 1].t) / DAY;
      const dh = pts[i].index - pts[i - 1].index;
      // Rejets : intervalle < 6 h (bruit), index qui recule (remplacement compteur),
      // > 25 h/j (saisie aberrante).
      if (dj >= 0.25 && dh >= 0 && dh / dj <= 25) debits.push(dh / dj);
    }
    if (debits.length) { total += ewmaOf(debits); vu = true; }
  }
  return vu ? total : null;
}

/** Repli : heures déclarées à la clôture (Σ heures ÷ jours couverts, par groupe). */
export function heuresJourDeclarees(releves: ReleveConsoLite[]): number | null {
  const parGroupe = new Map<string, { t: number; heures: number }[]>();
  for (const r of releves) {
    if (r.heures == null || r.heures < 0) continue;
    const k = r.groupeId ?? '_';
    const arr = parGroupe.get(k) ?? [];
    arr.push({ t: r.date.getTime(), heures: Number(r.heures) });
    parGroupe.set(k, arr);
  }
  let total = 0;
  let vu = false;
  for (const pts of parGroupe.values()) {
    if (pts.length < 2) continue;
    pts.sort((a, b) => a.t - b.t);
    const span = (pts[pts.length - 1].t - pts[0].t) / DAY;
    if (span < 3) continue; // fenêtre trop courte pour extrapoler
    // Les heures d'un relevé couvrent l'intervalle depuis le précédent → on
    // exclut le premier point (son intervalle est hors fenêtre).
    const somme = pts.slice(1).reduce((s, p) => s + p.heures, 0);
    const hj = somme / span;
    if (hj >= 0 && hj <= 25) { total += hj; vu = true; }
  }
  return vu ? total : null;
}

/** Débit RÉEL du (des) GE : Σ litres ÷ Σ heures sur les relevés où les deux existent. */
export function tauxHoraireReel(releves: ReleveConsoLite[]): number | null {
  let litres = 0, heures = 0;
  for (const r of releves) {
    if (r.conso != null && r.conso >= 0 && r.heures != null && r.heures > 0) {
      litres += Number(r.conso);
      heures += Number(r.heures);
    }
  }
  if (heures < 10) return null; // < 10 h cumulées : trop peu pour un débit fiable
  const taux = litres / heures;
  return taux >= 0.3 && taux <= 100 ? taux : null; // bornes de vraisemblance
}

/** EWMA des litres/jour entre relevés consécutifs (+ tendance par régression). */
function consoJourEwma(releves: ReleveConsoLite[]): { consoJour: number; tendance: EstimationConso['tendance'] } | null {
  const avec = releves.filter((r) => r.conso != null).sort((a, b) => a.date.getTime() - b.date.getTime());
  if (avec.length < 2) return null;
  const taux: { jour: number; debit: number }[] = [];
  for (let i = 1; i < avec.length; i++) {
    const dj = (avec[i].date.getTime() - avec[i - 1].date.getTime()) / DAY;
    if (dj > 0) taux.push({ jour: (avec[i].date.getTime() - avec[0].date.getTime()) / DAY, debit: Number(avec[i].conso) / dj });
  }
  const positifs = taux.filter((t) => t.debit > 0);
  if (!positifs.length) return null;
  const consoJour = ewmaOf(positifs.map((t) => t.debit));
  let tendance: EstimationConso['tendance'] = 'STABLE';
  if (positifs.length >= 3) {
    const slope = linregSlope(positifs.map((t) => t.jour), positifs.map((t) => t.debit));
    const seuil = consoJour * 0.02; // 2 %/jour
    tendance = slope > seuil ? 'HAUSSE' : slope < -seuil ? 'BAISSE' : 'STABLE';
  }
  return { consoJour, tendance };
}

/**
 * Estimation journalière d'un site, du plus fiable au moins fiable :
 *  1. débit réel × heures mesurées (compteur horaire, sinon heures déclarées) ;
 *  2. EWMA des litres consommés (quand les heures manquent) ;
 *  3. heures mesurées × débit théorique (litres déclarés inexploitables) ;
 *  4. médiane régionale des heures de coupure × débit (réel ou théorique) ;
 *  5. formule théorique kVA (aucune donnée).
 */
export function estimerConsoJour(input: {
  releves: ReleveConsoLite[];
  litresParHeureTheorique: number;
  heuresJourTheorique: number;
  heuresJourRegion?: number | null;
}): EstimationConso {
  const heuresMesurees = heuresJourDepuisIndex(input.releves) ?? heuresJourDeclarees(input.releves);
  const taux = tauxHoraireReel(input.releves);
  const ewma = consoJourEwma(input.releves);
  const tendance = ewma?.tendance ?? 'STABLE';

  if (heuresMesurees != null && taux != null) {
    return { consoJour: taux * heuresMesurees, source: 'horametre', tendance, heuresJour: heuresMesurees, tauxHoraireLh: taux };
  }
  if (ewma && ewma.consoJour > 0) {
    return { consoJour: ewma.consoJour, source: 'historique', tendance, heuresJour: heuresMesurees, tauxHoraireLh: taux };
  }
  if (heuresMesurees != null && input.litresParHeureTheorique > 0) {
    return { consoJour: input.litresParHeureTheorique * heuresMesurees, source: 'horametre', tendance, heuresJour: heuresMesurees, tauxHoraireLh: null };
  }
  if (input.heuresJourRegion != null && input.heuresJourRegion > 0 && input.litresParHeureTheorique > 0) {
    const t = taux ?? input.litresParHeureTheorique;
    return { consoJour: t * input.heuresJourRegion, source: 'regional', tendance, heuresJour: input.heuresJourRegion, tauxHoraireLh: taux };
  }
  return {
    consoJour: input.litresParHeureTheorique * input.heuresJourTheorique,
    source: 'theorique', tendance, heuresJour: null, tauxHoraireLh: null,
  };
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
// Mémoïsé 60 s : déduplique les scans répétés et les requêtes concurrentes d'un même chargement de page.
export function forecastSites(opts: { region?: string; horizonJours?: number; all?: boolean } = {}): Promise<SiteForecast[]> {
  const key = `forecast:${opts.region ?? '*'}:${opts.horizonJours ?? '*'}:${opts.all ? 'all' : 'due'}`;
  return memo(key, 60_000, () => forecastSitesImpl(opts));
}

async function forecastSitesImpl(opts: { region?: string; horizonJours?: number; all?: boolean }): Promise<SiteForecast[]> {
  const horizon = opts.horizonJours ?? getNum('appro.horizonJours', env.APPRO_HORIZON_JOURS);
  const leadSec = getNum('appro.leadTimeJours', env.APPRO_LEAD_TIME_JOURS) + getNum('appro.securiteJours', env.APPRO_STOCK_SECURITE_JOURS);
  const now = Date.now();
  const fenetre = new Date(now - 120 * DAY); // historique de conso sur 120 j

  const sites = await prisma.site.findMany({
    where: { isActive: true, ...(opts.region ? { region: opts.region } : {}) },
    select: {
      id: true, code: true, nom: true, region: true, latitude: true, longitude: true,
      cuveVolumeLitres: true, powerConfig: true, statutGE: true, puissanceGEkva: true,
      groupes: { where: { isActive: true }, select: { puissanceKva: true, statut: true } },
    },
  });
  if (!sites.length) return [];
  const ids = sites.map((s) => s.id);

  // Relevés GE de la fenêtre (conso + niveau de cuve + heures de marche), triés par date.
  const releves = await prisma.releveEnergie.findMany({
    where: { siteId: { in: ids }, source: 'GE', dateReleve: { gte: fenetre } },
    select: {
      siteId: true, groupeId: true, dateReleve: true,
      gasoilConsommeLitres: true, volumeGasoilLitres: true,
      heuresFonctGE: true, indexHeuresGE: true,
    },
    orderBy: { dateReleve: 'asc' },
  });
  const parSite = new Map<string, typeof releves>();
  for (const r of releves) {
    const arr = parSite.get(r.siteId) ?? [];
    arr.push(r);
    parSite.set(r.siteId, arr);
  }
  const toLite = (rs: typeof releves): ReleveConsoLite[] => rs.map((r) => ({
    date: r.dateReleve, groupeId: r.groupeId,
    conso: r.gasoilConsommeLitres != null ? n(r.gasoilConsommeLitres) : null,
    heures: r.heuresFonctGE != null ? n(r.heuresFonctGE) : null,
    index: r.indexHeuresGE != null ? n(r.indexHeuresGE) : null,
  }));

  // Médiane régionale des heures de marche/jour des sites SECOURS mesurables :
  // les coupures CEET sont corrélées géographiquement — meilleure hypothèse que
  // les 8 h/j forfaitaires pour un site secours sans historique propre.
  const heuresParRegion = new Map<string, number[]>();
  for (const site of sites) {
    if (site.statutGE !== 'GE_SECOURS') continue;
    const lite = toLite(parSite.get(site.id) ?? []);
    const hj = heuresJourDepuisIndex(lite) ?? heuresJourDeclarees(lite);
    if (hj != null) {
      const arr = heuresParRegion.get(site.region) ?? [];
      arr.push(hj);
      heuresParRegion.set(site.region, arr);
    }
  }

  // Dépotages récents, regroupés par site (rehausse le stock après le dernier relevé).
  const depots = await prisma.depotage.findMany({
    where: { siteId: { in: ids }, dateDepotage: { gte: fenetre } },
    select: { siteId: true, dateDepotage: true, volumeLitres: true },
  });
  const depotsBySite = new Map<string, typeof depots>();
  for (const d of depots) {
    const arr = depotsBySite.get(d.siteId) ?? [];
    arr.push(d);
    depotsBySite.set(d.siteId, arr);
  }

  const gp = geParams();
  const out: SiteForecast[] = [];
  for (const site of sites) {
    const hist = parSite.get(site.id) ?? [];
    // Niveau de cuve = DERNIER relevé PORTANT un volume. La cuve est partagée au
    // niveau site ; sur un site multi-GE, la clôture crée plusieurs relevés au
    // même timestamp dont un seul porte le volume — prendre le tout dernier
    // (souvent volume null) donnait un faux stock 0 L.
    let dernier: (typeof hist)[number] | null = null;
    for (let i = hist.length - 1; i >= 0; i--) {
      if (hist[i].volumeGasoilLitres != null) { dernier = hist[i]; break; }
    }

    // Stock actuel = dernier niveau de cuve relevé + dépotages POSTÉRIEURS.
    // Sans relevé, on part des dépotages de la fenêtre (meilleure estimation que 0).
    let stockActuel = dernier ? n(dernier.volumeGasoilLitres) : 0;
    // Vrai relevé de cuve (même 0 L) OU dépotage = donnée de niveau exploitable.
    let aVuStock = dernier != null;
    const seuilDate = dernier ? dernier.dateReleve : fenetre;
    for (const d of (depotsBySite.get(site.id) ?? [])) {
      if (d.dateDepotage > seuilDate) { stockActuel += n(d.volumeLitres); aVuStock = true; }
    }

    // Conso théorique = somme des GE actifs (multi-GE) ; sinon repli sur la puissance agrégée.
    const consoTheoriqueJour = (site.groupes.length
      ? site.groupes.reduce((s, g) => s + litresMoisGE(n(g.puissanceKva), g.statut, gp), 0)
      : calculerStockSite(site, null, gp).litresMois) / 30;

    // Débit L/h théorique (somme des GE) et heures/jour théoriques selon le statut.
    const litresParHeure = site.groupes.length
      ? site.groupes.reduce((s, g) => s + litresParHeureGE(n(g.puissanceKva), g.statut, gp), 0)
      : litresParHeureGE(n(site.puissanceGEkva), site.statutGE, gp);
    const heuresJourTheorique = (site.statutGE === 'GE_PERMANENT' ? gp.heuresMoisPermanent : gp.heuresMoisSecours) / 30;

    // Estimation découplée : débit réel × heures mesurées (compteur horaire),
    // avec replis successifs (EWMA litres → médiane régionale → théorique kVA).
    const est = estimerConsoJour({
      releves: toLite(hist),
      litresParHeureTheorique: litresParHeure,
      heuresJourTheorique,
      heuresJourRegion: site.statutGE === 'GE_SECOURS' ? mediane(heuresParRegion.get(site.region) ?? []) : null,
    });
    let consoJour = est.consoJour;
    const { source, tendance } = est;
    if (consoJour <= 0) consoJour = consoTheoriqueJour;

    if (consoJour <= 0) continue; // pas de GE / pas de conso → pas concerné
    // Aucune donnée de niveau (jamais de relevé de cuve ni de dépotage) → stock inconnu,
    // on ne peut pas prévoir. Un relevé mesurant 0 L, lui, reste classé (cuve vide réelle).
    if (!aVuStock) continue;

    const autonomieJours = Math.round((stockActuel / consoJour) * 10) / 10;
    const dateRupture = now + autonomieJours * DAY;
    const dateLivraison = dateRupture - leadSec * DAY;

    // Temps de marche du GE (h/jour) : mesuré si disponible, sinon dérivé du débit.
    const heuresGEJour = est.heuresJour != null
      ? Math.round(est.heuresJour * 10) / 10
      : litresParHeure > 0 ? Math.round((consoJour / litresParHeure) * 10) / 10 : null;
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
      derniereMesure: dernier ? dernier.dateReleve.toISOString() : null,
      heuresGEJour,
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
export function suggestTournees(forecasts: SiteForecast[], capacite = getNum('appro.camionCapaciteLitres', env.CAMION_CAPACITE_LITRES)): Tournee[] {
  // Découpe d'abord les besoins en demandes ≤ capacité (gros site = plusieurs
  // passages), PUIS regroupe — le surplus n'est plus jamais perdu.
  const dus = explodeDemandes(forecasts, capacite);
  const parRegion = new Map<string, Demande[]>();
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
    const loads = sweepCapacitated(geo, capacite) as Demande[][];
    // 2) Sites sans coordonnées : placés au mieux (premier camion ayant de la place).
    for (const f of sansGeo) {
      const q = f._part;
      const slot = loads.find((l) => l.reduce((s, x) => s + x._part, 0) + q <= capacite);
      if (slot) slot.push(f); else loads.push([f]);
    }

    // 3) Pour chaque camion : ordre optimisé + distance.
    for (const load of loads) {
      const ordered = twoOpt(nearestNeighbour(load)) as Demande[];
      const total = ordered.reduce((s, f) => s + f._part, 0);
      tournees.push({
        region,
        sites: ordered.map((f) => ({
          siteId: f.siteId, code: f.code, nom: f.nom, quantite: f._part,
          ...(f._nbPassages > 1 ? { passage: f._passage, nbPassages: f._nbPassages } : {}),
        })),
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
