import { prisma } from '../config/database';
import { litresMoisGE } from '../utils/calculator';
import { geParams } from './settings.service';
import { signeMouvement } from './mouvementsCarburant.service';
import { memo } from '../utils/memo';

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
 * La courbe des 12 mois applique la même équation mois par mois, au niveau du
 * parc : chaque point indique combien de sites étaient mesurables — une conso
 * mensuelle mesurée sur 30 sites sur 200 se lit comme telle.
 */

export interface LigneBilanSite {
  siteId: string; code: string; nom: string; region: string;
  stockDebut: number | null;
  stockFin: number | null;
  livre: number;
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
      where: { siteId: { in: siteIds }, dateMouvement: { lte: finFenetre }, type: { in: ['TRANSFERT_SORTIE', 'TRANSFERT_ENTREE', 'PURGE'] } },
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

export function bilanCarburant(debut: Date, fin: Date, region?: string) {
  const key = `bilan:${debut.getTime()}:${fin.getTime()}:${region ?? '*'}`;
  return memo(key, 60_000, () => bilanCarburantImpl(debut, fin, region));
}

async function bilanCarburantImpl(debut: Date, fin: Date, region?: string) {
  const sites = await prisma.site.findMany({
    where: { isActive: true, ...(region ? { region } : {}) },
    orderBy: { code: 'asc' },
    select: { id: true, code: true, nom: true, region: true, statutGE: true, puissanceGEkva: true,
      groupes: { where: { isActive: true }, select: { puissanceKva: true, statut: true } } },
  });
  const siteIds = sites.map((s) => s.id);

  // Fenêtre unique pour la période ET la courbe : 12 mois avant le mois de fin.
  const finMois = new Date(Date.UTC(fin.getUTCFullYear(), fin.getUTCMonth() + 1, 1));
  const debutCourbe = new Date(Date.UTC(fin.getUTCFullYear(), fin.getUTCMonth() - 11, 1));
  const debutFenetre = new Date(Math.min(debut.getTime(), debutCourbe.getTime()));
  const index = await construireIndex(siteIds, debutFenetre, new Date(Math.max(fin.getTime(), finMois.getTime())));

  const gp = geParams();
  const joursPeriode = Math.max(1, Math.round((fin.getTime() - debut.getTime()) / JOUR_MS));
  const t0 = debut.getTime();
  const t1 = fin.getTime();

  // ── Détail par site sur la période ──
  const lignes: LigneBilanSite[] = sites.map((site) => {
    const idx = index.get(site.id) ?? { releves: [], depots: [], mvts: [] };
    const stockDebut = stockA(idx, t0);
    const stockFin = stockA(idx, t1);
    const livre = r0(sommeEntre(idx.depots, t0, t1));
    const mouvements = r0(sommeEntre(idx.mvts, t0, t1));
    const mesure = stockDebut != null && stockFin != null;
    const conso = mesure ? r0(stockDebut! + livre + mouvements - stockFin!) : null;

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
      livre, mouvements,
      conso, consoTheorique,
      ecart: conso != null ? r0(conso - consoTheorique) : null,
      mesure,
      motifNonMesure: mesure ? null
        : stockDebut == null && stockFin == null ? 'Aucune jauge relevée avant la période'
        : stockDebut == null ? 'Pas de jauge avant le début de période'
        : 'Pas de jauge avant la fin de période',
    };
  });

  // ── Courbe : 12 mois glissants finissant au mois de `fin` ──
  const courbe: PointCourbe[] = [];
  for (let m = 0; m < 12; m++) {
    const b0 = new Date(Date.UTC(debutCourbe.getUTCFullYear(), debutCourbe.getUTCMonth() + m, 1));
    const b1 = new Date(Date.UTC(debutCourbe.getUTCFullYear(), debutCourbe.getUTCMonth() + m + 1, 1));
    let livre = 0, conso = 0, nbMesures = 0;
    for (const site of sites) {
      const idx = index.get(site.id);
      if (!idx) continue;
      livre += sommeEntre(idx.depots, b0.getTime(), b1.getTime());
      const s0 = stockA(idx, b0.getTime());
      const s1 = stockA(idx, b1.getTime());
      if (s0 != null && s1 != null) {
        conso += s0 + sommeEntre(idx.depots, b0.getTime(), b1.getTime()) + sommeEntre(idx.mvts, b0.getTime(), b1.getTime()) - s1;
        nbMesures++;
      }
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
    totaux: {
      nbSites: lignes.length,
      nbSitesMesures: mesures.length,
      // Les stocks totaux ne sont sommés QUE sur les sites mesurés : additionner
      // un début connu à une fin inconnue donnerait un delta parc mensonger.
      stockDebutLitres: r0(mesures.reduce((s, l) => s + (l.stockDebut ?? 0), 0)),
      stockFinLitres: r0(mesures.reduce((s, l) => s + (l.stockFin ?? 0), 0)),
      livreLitres: r0(lignes.reduce((s, l) => s + l.livre, 0)),
      mouvementsLitres: r0(lignes.reduce((s, l) => s + l.mouvements, 0)),
      consoLitres: r0(mesures.reduce((s, l) => s + (l.conso ?? 0), 0)),
      consoTheoriqueLitres: r0(mesures.reduce((s, l) => s + l.consoTheorique, 0)),
      consoJourMoyenne: mesures.length ? r0(mesures.reduce((s, l) => s + (l.conso ?? 0), 0) / joursPeriode) : 0,
    },
    lignes: lignes.sort((a, b) => (b.conso ?? -1) - (a.conso ?? -1)),
    courbe,
  };
}
