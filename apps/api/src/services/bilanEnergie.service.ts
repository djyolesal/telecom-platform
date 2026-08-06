import { prisma } from '../config/database';
import { getNum } from './settings.service';
import { memo } from '../utils/memo';

const n = (v: unknown): number => (v == null ? 0 : Number(v));
const r0 = (v: number) => Math.round(v);

/**
 * BILAN ÉNERGIE COMMERCIALE (CEET) SUR PÉRIODE — le pendant du bilan carburant.
 *
 * L'INDEX COMPTEUR joue le rôle de la jauge : la consommation d'un site sur
 * [début, fin] est la différence entre le dernier index connu avant chaque
 * borne — conso = index(fin) − index(début). Elle n'est calculée QUE si les
 * deux bornes ont un index : un index supposé fabriquerait une consommation
 * fantôme, exactement comme un stock supposé nul côté carburant.
 *
 * REPLI DÉCLARATIF : beaucoup de relevés CEET portent une consommation
 * DÉCLARÉE (`consommationKwh`) sans index cumulatif. Quand l'index manque à
 * une borne, la somme des consommations déclarées de la période sert de repli,
 * marquée comme telle (`source: 'declare'`) — un chiffre déclaré n'a pas la
 * force d'un delta de compteur, il doit se lire comme tel.
 *
 * Garde-fou : un index qui RECULE (remplacement de compteur, remise à zéro)
 * invalide le delta — le site passe en repli déclaratif plutôt qu'en
 * consommation négative absurde.
 */

export interface LigneBilanEnergie {
  siteId: string; code: string; nom: string; region: string;
  indexDebut: number | null;
  indexFin: number | null;
  consoKwh: number | null;         // delta d'index, ou somme déclarée (cf. source)
  source: 'index' | 'declare' | null;
  coutFCFA: number | null;
  nbReleves: number;               // relevés CEET dans la période
  mesure: boolean;                 // conso calculée par delta d'index
  motif: string | null;            // pourquoi le repli (ou rien du tout)
}

export interface PointCourbeEnergie {
  annee: number; mois: number;
  consoKwh: number | null;         // delta d'index parc (sites mesurables)
  declareKwh: number;              // Σ consommations déclarées (toujours connu)
  coutFCFA: number;
  nbSitesMesures: number;
  nbSites: number;
}

type Rel = { t: number; index: number | null; kwh: number | null; cout: number | null };

/** Dernier index connu ≤ date, ou null. */
function indexA(rels: Rel[], date: number): number | null {
  let idx: number | null = null;
  for (const r of rels) {
    if (r.t > date) break;
    if (r.index != null) idx = r.index;
  }
  return idx;
}

/** Somme des kWh déclarés (et coûts) des relevés dans ]après, jusqu'à]. */
function declareEntre(rels: Rel[], apres: number, jusqua: number): { kwh: number; cout: number; nb: number } {
  let kwh = 0, cout = 0, nb = 0;
  for (const r of rels) {
    if (r.t > jusqua) break;
    if (r.t <= apres) continue;
    nb++;
    kwh += n(r.kwh);
    cout += n(r.cout);
  }
  return { kwh, cout, nb };
}

export function bilanEnergie(debut: Date, fin: Date, region?: string) {
  const key = `bilan-energie:${debut.getTime()}:${fin.getTime()}:${region ?? '*'}`;
  return memo(key, 60_000, () => bilanEnergieImpl(debut, fin, region));
}

async function bilanEnergieImpl(debut: Date, fin: Date, region?: string) {
  const prixKwh = getNum('energie.prixKwhFCFA', 105);

  const sites = await prisma.site.findMany({
    // Seuls les sites raccordés au réseau commercial ont un bilan CEET.
    where: { isActive: true, powerConfig: { not: 'GE_UNIQUEMENT' }, ...(region ? { region } : {}) },
    orderBy: { code: 'asc' },
    select: { id: true, code: true, nom: true, region: true },
  });
  const siteIds = sites.map((s) => s.id);

  // Fenêtre unique : période + 12 mois de courbe, avec l'index de base d'avant
  // fenêtre (sans lui, la première borne n'a pas de point de départ).
  const finMois = new Date(Date.UTC(fin.getUTCFullYear(), fin.getUTCMonth() + 1, 1));
  const debutCourbe = new Date(Date.UTC(fin.getUTCFullYear(), fin.getUTCMonth() - 11, 1));
  const debutFenetre = new Date(Math.min(debut.getTime(), debutCourbe.getTime()));
  const finFenetre = new Date(Math.max(fin.getTime(), finMois.getTime()));

  const [base, dansFenetre] = await Promise.all([
    prisma.releveEnergie.findMany({
      where: { siteId: { in: siteIds }, source: 'CEET', indexCompteur: { not: null }, dateReleve: { lt: debutFenetre } },
      orderBy: [{ siteId: 'asc' }, { dateReleve: 'desc' }],
      distinct: ['siteId'],
      select: { siteId: true, dateReleve: true, indexCompteur: true, consommationKwh: true, coutEstime: true },
    }),
    prisma.releveEnergie.findMany({
      where: { siteId: { in: siteIds }, source: 'CEET', dateReleve: { gte: debutFenetre, lte: finFenetre } },
      orderBy: { dateReleve: 'asc' },
      select: { siteId: true, dateReleve: true, indexCompteur: true, consommationKwh: true, coutEstime: true },
    }),
  ]);

  const parSite = new Map<string, Rel[]>();
  const pousser = (siteId: string, r: { dateReleve: Date; indexCompteur: unknown; consommationKwh: unknown; coutEstime: unknown }) => {
    let liste = parSite.get(siteId);
    if (!liste) { liste = []; parSite.set(siteId, liste); }
    liste.push({
      t: r.dateReleve.getTime(),
      index: r.indexCompteur != null ? Number(r.indexCompteur) : null,
      kwh: r.consommationKwh != null ? Number(r.consommationKwh) : null,
      cout: r.coutEstime != null ? Number(r.coutEstime) : null,
    });
  };
  // La base (triée desc par la requête distinct) précède la fenêtre (asc).
  for (const r of base) pousser(r.siteId, r);
  for (const r of dansFenetre) pousser(r.siteId, r);

  const t0 = debut.getTime();
  const t1 = fin.getTime();

  /** Conso d'un site entre deux bornes : delta d'index, repli déclaré. */
  const consoEntre = (rels: Rel[], a: number, b: number) => {
    const i0 = indexA(rels, a);
    const i1 = indexA(rels, b);
    const decl = declareEntre(rels, a, b);
    // Index reculé = compteur remplacé/remis à zéro : le delta ne veut rien dire.
    if (i0 != null && i1 != null && i1 >= i0) {
      return { kwh: i1 - i0, source: 'index' as const, i0, i1, decl };
    }
    if (decl.nb > 0) {
      return { kwh: decl.kwh, source: 'declare' as const, i0, i1, decl };
    }
    return { kwh: null, source: null, i0, i1, decl };
  };

  const lignes: LigneBilanEnergie[] = sites.map((site) => {
    const rels = parSite.get(site.id) ?? [];
    const c = consoEntre(rels, t0, t1);
    const cout = c.kwh != null
      ? (c.source === 'declare' && c.decl.cout > 0 ? r0(c.decl.cout) : r0(c.kwh * prixKwh))
      : null;
    return {
      siteId: site.id, code: site.code, nom: site.nom, region: site.region,
      indexDebut: c.i0 != null ? r0(c.i0) : null,
      indexFin: c.i1 != null ? r0(c.i1) : null,
      consoKwh: c.kwh != null ? r0(c.kwh) : null,
      source: c.source,
      coutFCFA: cout,
      nbReleves: c.decl.nb,
      mesure: c.source === 'index',
      motif: c.source === 'index' ? null
        : c.i0 != null && c.i1 != null && c.i1 < c.i0 ? 'Index en recul (compteur remplacé ?) — repli sur le déclaré'
        : c.i0 == null && c.i1 == null ? (c.source === 'declare' ? 'Aucun index cumulatif — somme des consommations déclarées' : 'Aucun relevé CEET sur la période')
        : c.i0 == null ? 'Pas d\'index avant le début de période'
        : 'Pas d\'index avant la fin de période',
    };
  });

  // ── Courbe 12 mois ──
  const courbe: PointCourbeEnergie[] = [];
  for (let m = 0; m < 12; m++) {
    const b0 = Date.UTC(debutCourbe.getUTCFullYear(), debutCourbe.getUTCMonth() + m, 1);
    const b1 = Date.UTC(debutCourbe.getUTCFullYear(), debutCourbe.getUTCMonth() + m + 1, 1);
    let kwhIndex = 0, declareKwh = 0, cout = 0, nbMesures = 0;
    for (const site of sites) {
      const rels = parSite.get(site.id);
      if (!rels) continue;
      const c = consoEntre(rels, b0, b1);
      declareKwh += c.decl.kwh;
      cout += c.decl.cout > 0 ? c.decl.cout : (c.kwh ?? 0) * prixKwh;
      if (c.source === 'index') { kwhIndex += c.kwh!; nbMesures++; }
    }
    const d0 = new Date(b0);
    courbe.push({
      annee: d0.getUTCFullYear(), mois: d0.getUTCMonth() + 1,
      consoKwh: nbMesures > 0 ? r0(kwhIndex) : null,
      declareKwh: r0(declareKwh),
      coutFCFA: r0(cout),
      nbSitesMesures: nbMesures,
      nbSites: sites.length,
    });
  }

  const avecConso = lignes.filter((l) => l.consoKwh != null);
  const joursPeriode = Math.max(1, Math.round((t1 - t0) / 86_400_000));
  return {
    periode: { debut: debut.toISOString(), fin: fin.toISOString(), jours: joursPeriode },
    region: region ?? null,
    prixKwh,
    totaux: {
      nbSites: lignes.length,
      nbSitesMesures: lignes.filter((l) => l.mesure).length,
      nbSitesDeclares: lignes.filter((l) => l.source === 'declare').length,
      consoKwh: r0(avecConso.reduce((s, l) => s + (l.consoKwh ?? 0), 0)),
      consoKwhMesuree: r0(lignes.filter((l) => l.mesure).reduce((s, l) => s + (l.consoKwh ?? 0), 0)),
      coutFCFA: r0(avecConso.reduce((s, l) => s + (l.coutFCFA ?? 0), 0)),
      consoJourMoyenneKwh: avecConso.length ? r0(avecConso.reduce((s, l) => s + (l.consoKwh ?? 0), 0) / joursPeriode) : 0,
    },
    lignes: lignes.sort((a, b) => (b.consoKwh ?? -1) - (a.consoKwh ?? -1)),
    courbe,
  };
}
