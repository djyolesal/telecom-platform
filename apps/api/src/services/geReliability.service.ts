import { prisma } from '../config/database';

/**
 * Fiabilité des groupes électrogènes par MARQUE : croise les pannes (curatives)
 * avec la marque des GE, pour éclairer les décisions d'achat.
 *
 * Rattachement panne → marque, par ordre de fiabilité décroissante :
 *  1. curative portant `actifId` d'un GE → marque exacte de ce GE ;
 *  2. curative « GE » (catégorie GE ou incident PANNE_GE) sur un site dont TOUS
 *     les GE actifs partagent la même marque → imputée à cette marque ;
 *  3. sinon (site multi-marques, ou marque non renseignée) → NON imputable
 *     (comptée à part, pour la transparence sur la couverture des données).
 */
export interface MarqueFiabilite {
  marque: string;
  nbGE: number;
  nbCuratives: number;
  tauxPanne: number;       // curatives par GE sur la période
  heuresTotales: number;   // heures de marche cumulées des GE de la marque
  mtbfHeures: number | null; // heures moyennes entre pannes (heuresTotales / pannes)
}

export interface GeReliabilityReport {
  jours: number;
  parMarque: MarqueFiabilite[];
  curativesNonImputables: number; // pannes GE qu'on n'a pas pu rattacher à une marque
  gesSansMarque: number;          // GE actifs dont la marque reste à renseigner
  couvertureMarquePct: number;    // part des GE actifs ayant une marque
}

const SANS = '(sans marque)';

export async function geReliabilityByMarque(opts: { jours?: number } = {}): Promise<GeReliabilityReport> {
  const jours = opts.jours && opts.jours > 0 ? opts.jours : 180;
  const depuis = new Date(Date.now() - jours * 86400000);

  // GE actifs sur site (marque + site → imputation).
  const ges = await prisma.groupeElectrogene.findMany({
    where: { isActive: true, siteId: { not: null } },
    select: { id: true, marque: true, siteId: true },
  });
  const marqueParGe = new Map<string, string | null>(ges.map((g) => [g.id, g.marque]));
  // Marque unique d'un site (si tous ses GE actifs ont la même marque non nulle).
  const marquesParSite = new Map<string, Set<string>>();
  for (const g of ges) {
    if (!g.siteId || !g.marque) continue;
    (marquesParSite.get(g.siteId) ?? marquesParSite.set(g.siteId, new Set()).get(g.siteId)!).add(g.marque);
  }
  const marqueUniqueSite = (siteId: string): string | null => {
    const set = marquesParSite.get(siteId);
    return set && set.size === 1 ? [...set][0] : null;
  };

  // Heures de marche cumulées par GE (Σ heuresFonctGE des relevés sur la fenêtre).
  const relevesGE = await prisma.releveEnergie.groupBy({
    by: ['groupeId'],
    where: { source: 'GE', dateReleve: { gte: depuis }, groupeId: { not: null }, heuresFonctGE: { not: null } },
    _sum: { heuresFonctGE: true },
  });
  const heuresParGe = new Map<string, number>();
  for (const r of relevesGE) if (r.groupeId) heuresParGe.set(r.groupeId, Number(r._sum.heuresFonctGE ?? 0));

  // Curatives sur la période, avec l'actif et l'incident éventuels.
  const curatives = await prisma.maintenance.findMany({
    where: { type: 'CURATIVE', datePlanifiee: { gte: depuis } },
    select: { actifId: true, actifType: true, categorie: true, siteId: true, incident: { select: { type: true } } },
  });

  // Agrégation par marque.
  const agg = new Map<string, { nbGE: number; nbCuratives: number; heures: number }>();
  const ensure = (m: string) => agg.get(m) ?? agg.set(m, { nbGE: 0, nbCuratives: 0, heures: 0 }).get(m)!;

  let gesSansMarque = 0;
  for (const g of ges) {
    const m = g.marque ?? SANS;
    if (!g.marque) gesSansMarque++;
    const a = ensure(m);
    a.nbGE += 1;
    a.heures += heuresParGe.get(g.id) ?? 0;
  }

  let nonImputables = 0;
  for (const c of curatives) {
    const estGE = c.actifType === 'GE' || c.categorie === 'GE' || c.incident?.type === 'PANNE_GE';
    if (!estGE) continue;
    // 1. rattachement exact par actifId
    let marque = c.actifId ? marqueParGe.get(c.actifId) ?? null : null;
    // 2. imputation par site mono-marque
    if (!marque && c.siteId) marque = marqueUniqueSite(c.siteId);
    if (!marque) { nonImputables++; continue; }
    ensure(marque).nbCuratives += 1;
  }

  const parMarque: MarqueFiabilite[] = [...agg.entries()]
    .map(([marque, a]) => ({
      marque,
      nbGE: a.nbGE,
      nbCuratives: a.nbCuratives,
      tauxPanne: a.nbGE > 0 ? Math.round((a.nbCuratives / a.nbGE) * 100) / 100 : 0,
      heuresTotales: Math.round(a.heures),
      mtbfHeures: a.nbCuratives > 0 ? Math.round(a.heures / a.nbCuratives) : null,
    }))
    // Les plus défaillantes d'abord (taux de panne décroissant).
    .sort((x, y) => y.tauxPanne - x.tauxPanne || y.nbCuratives - x.nbCuratives);

  const nbGEtotal = ges.length;
  return {
    jours,
    parMarque,
    curativesNonImputables: nonImputables,
    gesSansMarque,
    couvertureMarquePct: nbGEtotal > 0 ? Math.round(((nbGEtotal - gesSansMarque) / nbGEtotal) * 100) : 0,
  };
}
