import { prisma } from '../config/database';
import { litresMoisGE } from '../utils/calculator';
import { geParams } from './settings.service';
import { signeMouvement } from './mouvementsCarburant.service';
import { memo } from '../utils/memo';
import { chargerSeries, bilanMensuelSerie, fluxDuMois, SerieCarburant } from './stocksMensuels.service';
import { sansCarburant } from '../utils/perimetreCarburant';

const n = (v: unknown): number => (v == null ? 0 : Number(v));
const r0 = (v: number) => Math.round(v);
const JOUR_MS = 86_400_000;

/**
 * BILAN CARBURANT SUR PÉRIODE — stock aux deux bornes, consommation déduite.
 *
 * Le stock « à une date » suit la même règle que le stock courant (source
 * unique du lot 1), simplement bornée à la date demandée :
 *   stock(d) = dernière jauge GE ≤ d + Σ dépotages ∈ ]jauge, d]
 *              + Σ mouvements ∈ ]jauge, d] (transferts nets − purges)
 *
 * La consommation d'un site sur [début, fin] vient de l'équation de
 * conservation : conso = stock(début) + livré + mouvements − stock(fin).
 * Elle n'est calculée QUE si les deux bornes de stock sont connues (une jauge
 * existe avant chaque borne) — un stock supposé nul fabriquerait une
 * consommation fantôme. Les sites non mesurables sont listés avec leur motif,
 * et le « livré » y reste compté : la logistique, elle, est toujours connue.
 *
 * MAIS dès que la période demandée couvre des MOIS ENTIERS - ce que font les
 * trois raccourcis de la page, et la courbe par construction - c'est la méthode
 * validée avec l'exploitant le 07/09/2026 qui s'applique (stocksMensuels) :
 * frontières interpolées, fenêtre d'au moins 10 jours, gardes sur l'index GE.
 *
 * Deux moteurs publiaient jusqu'ici le même mois par deux chemins différents,
 * dans deux menus différents. Le report brut de la jauge aux frontières
 * SURESTIME systématiquement - c'est le constat qui a fait naître la méthode
 * validée ; le garder en parallèle revenait à publier deux « stock au 1er »
 * sans dire lequel fait foi. L'équation de conservation ci-dessus ne sert donc
 * plus qu'aux périodes libres, et la réponse le signale (`methode`).
 *
 * La courbe des 12 mois indique, pour chaque point, combien de sites étaient
 * mesurables : une conso mensuelle mesurée sur 30 sites sur 200 se lit
 * comme telle.
 */

export interface LigneBilanSite {
  siteId: string; code: string; nom: string; region: string;
  stockDebut: number | null;
  stockFin: number | null;
  livre: number;
  /**
   * Part du livré qui tombe dans un mois où le site a un bilan (au moins un
   * relevé de cuve) : c'est ce que totalise le rapport « Stocks carburant
   * mensuels », qui ne liste que ces sites-là. Sur une période libre : le livré
   * des sites mesurés.
   */
  livreReleve: number;
  mouvements: number;              // transferts nets − purges sur la période
  conso: number | null;            // équation de conservation
  consoTheorique: number;          // formule kVA prorata des jours
  ecart: number | null;            // conso − théorique
  mesure: boolean;
  motifNonMesure: string | null;
}

export interface PointCourbe {
  annee: number; mois: number;
  livre: number;                   // Σ dépotages du mois (toujours connu)
  conso: number | null;            // conservation parc, sites mesurables
  nbSitesMesures: number;
  nbSites: number;
}

/**
 * La période demandée couvre-t-elle des MOIS CALENDAIRES ENTIERS ?
 *
 * Si oui, c'est la méthode validée qui s'applique, mois par mois. Les trois
 * raccourcis de la page (mois en cours, mois dernier, trimestre) tombent tous
 * dans ce cas ; une période saisie à la main, rarement.
 */
export function moisEntiers(debut: Date, fin: Date): Array<{ annee: number; mois: number }> | null {
  const d = new Date(debut);
  const f = new Date(fin);
  // Début au 1er à 00:00 UTC, fin au dernier jour du mois (la page borne à
  // 23:59:59 ou au 1er du mois suivant : les deux sont acceptés).
  if (d.getUTCDate() !== 1 || d.getUTCHours() || d.getUTCMinutes()) return null;
  // Deux écritures acceptées pour la même borne : « au 1er du mois suivant »
  // (exclusive) et « au dernier jour du mois » (inclusive, ce que produit la
  // page, horodatée à 23:59:59).
  const bornExclusive = f.getUTCDate() === 1 && !f.getUTCHours() && !f.getUTCMinutes();
  const finExclusive = bornExclusive ? f : new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + 1, 1));
  if (finExclusive <= d) return null;
  // Forme inclusive : le jour donné doit bien FERMER son mois, sinon la période
  // s'arrête en cours de mois et la méthode calendaire ne s'applique pas.
  if (!bornExclusive) {
    const dernierJour = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + 1, 0)).getUTCDate();
    if (f.getUTCDate() !== dernierJour) return null;
  }
  const out: Array<{ annee: number; mois: number }> = [];
  for (let c = new Date(d); c < finExclusive; c = new Date(Date.UTC(c.getUTCFullYear(), c.getUTCMonth() + 1, 1))) {
    out.push({ annee: c.getUTCFullYear(), mois: c.getUTCMonth() + 1 });
    if (out.length > 36) return null; // garde-fou : pas de période démesurée
  }
  return out.length ? out : null;
}

type Evt = { t: number; v: number };
type SiteIdx = {
  releves: { t: number; stock: number }[]; // asc
  depots: Evt[];  // asc
  mvts: Evt[];    // asc, signés
};

/** Somme des événements dont le timestamp est dans ]apres, jusqua]. */
function sommeEntre(evts: Evt[], apres: number, jusqua: number): number {
  let s = 0;
  for (const e of evts) {
    if (e.t > jusqua) break;
    if (e.t > apres) s += e.v;
  }
  return s;
}

/** Stock d'un site à une date, ou null si aucune jauge ne précède la date. */
function stockA(idx: SiteIdx, date: number): number | null {
  let releve: { t: number; stock: number } | null = null;
  for (const r of idx.releves) {
    if (r.t > date) break;
    releve = r;
  }
  if (!releve) return null;
  return releve.stock + sommeEntre(idx.depots, releve.t, date) + sommeEntre(idx.mvts, releve.t, date);
}

/**
 * Index des événements carburant par site sur une fenêtre. La « base » (dernière
 * jauge AVANT la fenêtre) est chargée à part : sans elle, les premières bornes
 * n'auraient aucun point de départ pour les sites relevés avant la fenêtre.
 */
async function construireIndex(siteIds: string[], deputFenetre: Date, finFenetre: Date): Promise<Map<string, SiteIdx>> {
  const [base, dansFenetre, depots, mvts] = await Promise.all([
    prisma.releveEnergie.findMany({
      where: { siteId: { in: siteIds }, source: 'GE', volumeGasoilLitres: { not: null }, dateReleve: { lt: deputFenetre } },
      orderBy: [{ siteId: 'asc' }, { dateReleve: 'desc' }],
      distinct: ['siteId'],
      select: { siteId: true, dateReleve: true, volumeGasoilLitres: true },
    }),
    prisma.releveEnergie.findMany({
      where: { siteId: { in: siteIds }, source: 'GE', volumeGasoilLitres: { not: null }, dateReleve: { gte: deputFenetre, lte: finFenetre } },
      orderBy: { dateReleve: 'asc' },
      select: { siteId: true, dateReleve: true, volumeGasoilLitres: true },
    }),
    prisma.depotage.findMany({
      // Depuis la base la plus ancienne : un dépotage entre la jauge de base et
      // la fenêtre compte dans le stock de la première borne.
      where: { siteId: { in: siteIds }, dateDepotage: { lte: finFenetre } },
      orderBy: { dateDepotage: 'asc' },
      select: { siteId: true, dateDepotage: true, volumeLitres: true },
    }),
    prisma.mouvementCarburant.findMany({
      where: { siteId: { in: siteIds }, dateMouvement: { lte: finFenetre }, type: { in: ['TRANSFERT_SORTIE', 'TRANSFERT_ENTREE', 'PURGE'] }, statut: 'VALIDE' },
      orderBy: { dateMouvement: 'asc' },
      select: { siteId: true, dateMouvement: true, type: true, volumeLitres: true },
    }),
  ]);

  const index = new Map<string, SiteIdx>();
  const de = (id: string): SiteIdx => {
    let s = index.get(id);
    if (!s) { s = { releves: [], depots: [], mvts: [] }; index.set(id, s); }
    return s;
  };
  for (const r of base) de(r.siteId).releves.push({ t: r.dateReleve.getTime(), stock: n(r.volumeGasoilLitres) });
  for (const r of dansFenetre) de(r.siteId).releves.push({ t: r.dateReleve.getTime(), stock: n(r.volumeGasoilLitres) });
  for (const d of depots) de(d.siteId).depots.push({ t: d.dateDepotage.getTime(), v: n(d.volumeLitres) });
  for (const m of mvts) if (m.siteId) de(m.siteId).mvts.push({ t: m.dateMouvement.getTime(), v: signeMouvement(m.type) * n(m.volumeLitres) });
  return index;
}

// `portee` : périmètre d'un compte prestataire (sites de SES lots). La clé de
// cache doit l'inclure — sans elle, le bilan périmétré d'un prestataire
// pouvait être servi à un interne, et réciproquement.
export type PorteeBilan = { where: Record<string, unknown>; cle: string };

export function bilanCarburant(debut: Date, fin: Date, region?: string, portee?: PorteeBilan) {
  const key = `bilan:${debut.getTime()}:${fin.getTime()}:${region ?? '*'}:${portee?.cle ?? '*'}`;
  return memo(key, 60_000, () => bilanCarburantImpl(debut, fin, region, portee));
}

async function bilanCarburantImpl(debut: Date, fin: Date, region?: string, portee?: PorteeBilan) {
  const tousLesSites = await prisma.site.findMany({
    where: { isActive: true, ...(region ? { region } : {}), ...(portee?.where ?? {}) },
    orderBy: { code: 'asc' },
    select: { id: true, code: true, nom: true, region: true, statutGE: true, puissanceGEkva: true, cuveVolumeLitres: true,
      groupes: { where: { isActive: true }, select: { puissanceKva: true, statut: true } } },
  });
  const siteIds = tousLesSites.map((s) => s.id);

  // Fenêtre unique pour la période ET la courbe : 12 mois avant le mois de fin.
  const finMois = new Date(Date.UTC(fin.getUTCFullYear(), fin.getUTCMonth() + 1, 1));
  const debutCourbe = new Date(Date.UTC(fin.getUTCFullYear(), fin.getUTCMonth() - 11, 1));
  const debutFenetre = new Date(Math.min(debut.getTime(), debutCourbe.getTime()));
  const index = await construireIndex(siteIds, debutFenetre, new Date(Math.max(fin.getTime(), finMois.getTime())));

  const gp = geParams();
  const joursPeriode = Math.max(1, Math.round((fin.getTime() - debut.getTime()) / JOUR_MS));
  const t0 = debut.getTime();
  const t1 = fin.getTime();

  // Méthode validée dès que la période tient en mois entiers ; la courbe, elle,
  // y passe toujours (ses points SONT des mois).
  const mois = moisEntiers(debut, fin);
  const series = await chargerSeries(siteIds, new Date(Math.max(fin.getTime(), finMois.getTime())));

  // PÉRIMÈTRE : un site sans groupe électrogène ni cuve n'a pas de stock - il
  // gonflait « sites mesurés : N / 558 » et noyait la liste de lignes « aucun
  // relevé ». MAIS la logistique est toujours connue, et un site que son statut
  // dit « sans GE » peut avoir reçu du gasoil : on ne l'écarte que s'il n'a
  // AUCUNE donnée de carburant (relevé, livraison, mouvement). Écarter un site
  // qui a reçu du carburant retirerait du « livré » des totaux.
  const aDesDonnees = (id: string) => {
    const s = series.get(id);
    return !!s && (s.releves.length > 0 || s.livraisons.length > 0 || s.mouvements.length > 0);
  };
  const sites = tousLesSites.filter((s) => !sansCarburant(s) || aDesDonnees(s.id));
  const nbSitesHorsPerimetre = tousLesSites.length - sites.length;
  const MOIS_FR = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];

  /** Agrège les bilans mensuels validés d'un site sur la période. */
  function parMois(serie: SerieCarburant | undefined): Pick<LigneBilanSite,
    'stockDebut' | 'stockFin' | 'livre' | 'livreReleve' | 'mouvements' | 'conso' | 'mesure' | 'motifNonMesure'> {
    const bilans = mois!.map((m) => ({ m, b: bilanMensuelSerie(serie, m.annee, m.mois) }));
    const manquant = bilans.find((x) => x.b == null);
    if (manquant) {
      // Stock et conso inconnus, mais le LIVRÉ ne l'est pas : il vient des bons
      // de livraison. Il était compté pour zéro faute de bilan, et le total de
      // la page perdait le gasoil livré aux sites non relevés dans le mois.
      const flux = mois!.map((m) => fluxDuMois(serie, m.annee, m.mois));
      return {
        stockDebut: null, stockFin: null,
        livre: r0(flux.reduce((s, f) => s + f.livraisons, 0)),
        // Seulement les mois où le site a un bilan : ce que reprend le rapport mensuel.
        livreReleve: r0(bilans.reduce((s, x) => s + (x.b?.livraisons ?? 0), 0)),
        mouvements: r0(flux.reduce((s, f) => s + f.mouvements, 0)),
        conso: null, mesure: false,
        motifNonMesure: `Aucun relevé de cuve en ${MOIS_FR[manquant.m.mois - 1]} ${manquant.m.annee}`,
      };
    }
    const b = bilans.map((x) => x.b!);
    const incalculable = b.find((x) => x.conso == null);
    return {
      stockDebut: b[0].stockDebut,
      stockFin: b[b.length - 1].stockFin,
      livre: r0(b.reduce((s, x) => s + x.livraisons, 0)),
      livreReleve: r0(b.reduce((s, x) => s + x.livraisons, 0)),
      mouvements: r0(b.reduce((s, x) => s + x.mouvements, 0)),
      conso: incalculable ? null : r0(b.reduce((s, x) => s + (x.conso ?? 0), 0)),
      mesure: !incalculable,
      motifNonMesure: incalculable ? (incalculable.drapeaux[0] ?? 'Consommation incalculable') : null,
    };
  }

  // ── Détail par site sur la période ──
  const lignes: LigneBilanSite[] = sites.map((site) => {
    const idx = index.get(site.id) ?? { releves: [], depots: [], mvts: [] };
    let stockDebut: number | null;
    let stockFin: number | null;
    let livre: number;
    let livreReleve: number;
    let mouvements: number;
    let conso: number | null;
    let mesure: boolean;
    let motifNonMesure: string | null;
    if (mois) {
      ({ stockDebut, stockFin, livre, livreReleve, mouvements, conso, mesure, motifNonMesure } = parMois(series.get(site.id)));
    } else {
      stockDebut = stockA(idx, t0);
      stockFin = stockA(idx, t1);
      livre = r0(sommeEntre(idx.depots, t0, t1));
      mouvements = r0(sommeEntre(idx.mvts, t0, t1));
      mesure = stockDebut != null && stockFin != null;
      conso = mesure ? r0(stockDebut! + livre + mouvements - stockFin!) : null;
      livreReleve = mesure ? livre : 0;
      motifNonMesure = mesure ? null
        : stockDebut == null && stockFin == null ? 'Aucune jauge relevée avant la période'
        : stockDebut == null ? 'Pas de jauge avant le début de période'
        : 'Pas de jauge avant la fin de période';
    }

    // Théorique : somme des GE actifs (repli sur la puissance agrégée du site),
    // prorata des jours de la période.
    const theoriqueMois = site.groupes.length
      ? site.groupes.reduce((s, g) => s + litresMoisGE(n(g.puissanceKva), g.statut, gp), 0)
      : litresMoisGE(n(site.puissanceGEkva), site.statutGE, gp);
    const consoTheorique = r0((theoriqueMois / 30) * joursPeriode);

    return {
      siteId: site.id, code: site.code, nom: site.nom, region: site.region,
      stockDebut: stockDebut != null ? r0(stockDebut) : null,
      stockFin: stockFin != null ? r0(stockFin) : null,
      livre, livreReleve, mouvements,
      conso, consoTheorique,
      ecart: conso != null ? r0(conso - consoTheorique) : null,
      mesure,
      motifNonMesure,
    };
  });

  // ── Courbe : 12 mois glissants finissant au mois de `fin` ──
  const courbe: PointCourbe[] = [];
  for (let m = 0; m < 12; m++) {
    const b0 = new Date(Date.UTC(debutCourbe.getUTCFullYear(), debutCourbe.getUTCMonth() + m, 1));
    const b1 = new Date(Date.UTC(debutCourbe.getUTCFullYear(), debutCourbe.getUTCMonth() + m + 1, 1));
    // MÉTHODE VALIDÉE pour chaque point : un point de courbe EST un mois. La
    // conservation brute donnait ici une seconde série mensuelle, différente de
    // celle du rapport « Stocks carburant mensuels » pour les mêmes mois.
    let livre = 0, conso = 0, nbMesures = 0;
    for (const site of sites) {
      const serie = series.get(site.id);
      // Le livré de TOUS les sites, mesurés ou non : même règle que le total.
      livre += fluxDuMois(serie, b0.getUTCFullYear(), b0.getUTCMonth() + 1).livraisons;
      const b = bilanMensuelSerie(serie, b0.getUTCFullYear(), b0.getUTCMonth() + 1);
      if (b?.conso != null) { conso += b.conso; nbMesures++; }
    }
    courbe.push({
      annee: b0.getUTCFullYear(), mois: b0.getUTCMonth() + 1,
      livre: r0(livre),
      conso: nbMesures > 0 ? r0(conso) : null,
      nbSitesMesures: nbMesures,
      nbSites: sites.length,
    });
  }

  const mesures = lignes.filter((l) => l.mesure);
  return {
    periode: { debut: debut.toISOString(), fin: fin.toISOString(), jours: joursPeriode },
    region: region ?? null,
    // Le lecteur doit savoir d'où sortent les chiffres qu'il lit : les deux
    // méthodes ne donnent pas le même « stock au 1er ».
    methode: mois ? 'BILAN_MATIERE' : 'CONSERVATION',
    moisCouverts: mois?.length ?? 0,
    totaux: {
      nbSites: lignes.length,
      nbSitesHorsPerimetre,
      nbSitesMesures: mesures.length,
      // Les stocks totaux ne sont sommés QUE sur les sites mesurés : additionner
      // un début connu à une fin inconnue donnerait un delta parc mensonger.
      stockDebutLitres: r0(mesures.reduce((s, l) => s + (l.stockDebut ?? 0), 0)),
      stockFinLitres: r0(mesures.reduce((s, l) => s + (l.stockFin ?? 0), 0)),
      // LIVRÉ RÉEL : toutes les livraisons de la période, sites relevés ou non -
      // c'est le chiffre des bons de livraison. La part des sites relevés est
      // donnée à côté : c'est le livré du rapport « Stocks carburant mensuels »,
      // qui ne liste que les sites ayant un bilan dans le mois.
      livreLitres: r0(lignes.reduce((s, l) => s + l.livre, 0)),
      livreSitesRelevesLitres: r0(lignes.reduce((s, l) => s + l.livreReleve, 0)),
      mouvementsLitres: r0(lignes.reduce((s, l) => s + l.mouvements, 0)),
      consoLitres: r0(mesures.reduce((s, l) => s + (l.conso ?? 0), 0)),
      consoTheoriqueLitres: r0(mesures.reduce((s, l) => s + l.consoTheorique, 0)),
      consoJourMoyenne: mesures.length ? r0(mesures.reduce((s, l) => s + (l.conso ?? 0), 0) / joursPeriode) : 0,
    },
    lignes: lignes.sort((a, b) => (b.conso ?? -1) - (a.conso ?? -1)),
    courbe,
  };
}
