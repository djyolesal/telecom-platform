import { prisma } from '../config/database';

/**
 * BILAN MENSUEL DES STOCKS CARBURANT — méthode validée avec l'exploitant le
 * 07/09/2026 sur 4 mois de relevés terrain (voir le fichier d'étude
 * stocks-mensuels-v2.xlsx) :
 *
 *  - CONSO = bilan matière « H1 » : fenêtre du dernier relevé de cuve du mois
 *    au dernier relevé antérieur, ÉLARGIE vers l'arrière si < 10 jours (une
 *    fenêtre courte extrapolée au mois amplifie n'importe quel accident) ;
 *    conso = niveau₁ + livraisons − niveau₂ ; conso/j × jours calendaires.
 *  - STOCKS AUX FRONTIÈRES : interpolés par la conso/j depuis le relevé le
 *    plus proche (livraisons de l'intervalle comptées) — jamais de report
 *    brut, qui surestimait systématiquement (la cuve ne fait que descendre).
 *  - GARDES : delta d'index GE rejeté si négatif ou > 25 h/j (compteur
 *    changé/aberrant) ; L/h publié seulement dans [0,5 – 60] — hors plage,
 *    l'index ment (bloqué) et le site est signalé.
 *  - CONTRE-ÉPREUVE vol/fuite : « gasoil non expliqué » = conso mesurée −
 *    (débit lissé du site × heures GE de la fenêtre), publié si > 200 L ET
 *    > 1,5× l'attendu. La prémisse « débit constant » ne tient pas assez
 *    (CV médian 36 %) pour REMPLACER le bilan matière — elle le CONTRÔLE.
 */

export interface ReleveStockLite {
  date: Date;
  volume: number | null;      // niveau de cuve (L)
  index: number | null;       // index heures GE (compteur)
  groupeId: string | null;
}
export interface LivraisonLite { date: Date; litres: number }

export interface LigneStockMensuel {
  siteId: string;
  site: string;
  region: string;
  stockDebut: number;
  stockFin: number;
  livraisons: number;
  conso: number | null;
  consoJour: number | null;
  debitLh: number | null;
  gasoilInexplique: number | null;
  fenetreJours: number;
  drapeaux: string[];
}

const JOUR_MS = 86_400_000;
const FENETRE_MIN_J = 10;
const VOLUME_MAX_PLAUSIBLE = 5000;

const sommeLivraisons = (livs: LivraisonLite[], a: Date, b: Date) =>
  livs.reduce((s, l) => (l.date > a && l.date <= b ? s + l.litres : s), 0);

/** Deltas d'heures GE valides d'une fenêtre : par groupe, rejetés si négatifs
 *  ou > 25 h/j — puis sommés (un site multi-GE cumule ses moteurs). */
function heuresFenetre(releves: ReleveStockLite[], a: Date, b: Date): number | null {
  const parGroupe = new Map<string, { t: number; index: number }[]>();
  for (const r of releves) {
    if (r.index == null || r.date < a || r.date > b) continue;
    const k = r.groupeId ?? '_';
    const arr = parGroupe.get(k) ?? [];
    arr.push({ t: r.date.getTime(), index: r.index });
    parGroupe.set(k, arr);
  }
  let total = 0;
  let vu = false;
  for (const pts of parGroupe.values()) {
    pts.sort((x, y) => x.t - y.t);
    const premier = pts[0];
    const dernier = pts[pts.length - 1];
    if (pts.length < 2) continue;
    const dh = dernier.index - premier.index;
    const dj = (dernier.t - premier.t) / JOUR_MS;
    if (dh < 0 || dj <= 0 || dh / dj > 25) continue;
    total += dh;
    vu = true;
  }
  return vu ? total : null;
}

/** Débit lissé (L/h) du site : médiane des débits mesurés sur les intervalles
 *  valides de TOUTE la période fournie — constante de contrôle, pas de mesure. */
export function debitLisse(releves: ReleveStockLite[], livraisons: LivraisonLite[]): number | null {
  const niveaux = releves.filter((r) => r.volume != null).sort((a, b) => a.date.getTime() - b.date.getTime());
  const debits: number[] = [];
  for (let i = 1; i < niveaux.length; i++) {
    const r1 = niveaux[i - 1];
    const r2 = niveaux[i];
    const jours = (r2.date.getTime() - r1.date.getTime()) / JOUR_MS;
    if (jours < 1) continue;
    const conso = r1.volume! + sommeLivraisons(livraisons, r1.date, r2.date) - r2.volume!;
    if (conso <= 0) continue;
    const heures = heuresFenetre(releves, r1.date, r2.date);
    if (heures == null || heures <= 0) continue;
    const lh = conso / heures;
    if (lh >= 0.5 && lh <= 60) debits.push(lh);
  }
  if (debits.length < 2) return null;
  debits.sort((a, b) => a - b);
  const m = Math.floor(debits.length / 2);
  return debits.length % 2 ? debits[m] : (debits[m - 1] + debits[m]) / 2;
}

/** Cœur pur de la méthode : bilan d'UN site pour UN mois. */
export function bilanMensuelSite(opts: {
  releves: ReleveStockLite[];       // relevés GE du site (niveaux + index), toute la période disponible
  livraisons: LivraisonLite[];
  annee: number;
  mois: number;                     // 1-12
}): Omit<LigneStockMensuel, 'siteId' | 'site' | 'region'> | null {
  const { annee, mois } = opts;
  const premier = new Date(Date.UTC(annee, mois - 1, 1));
  const suivant = new Date(Date.UTC(annee, mois, 1));
  const nbJours = Math.round((suivant.getTime() - premier.getTime()) / JOUR_MS);

  const niveaux = opts.releves
    .filter((r) => r.volume != null && r.volume <= VOLUME_MAX_PLAUSIBLE)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const duMois = niveaux.filter((r) => r.date >= premier && r.date < suivant);
  if (!duMois.length) return null;
  const r2 = duMois[duMois.length - 1];

  const drapeaux: string[] = [];
  const avant = niveaux.filter((r) => r.date < premier);
  let r1: ReleveStockLite;
  if (avant.length) {
    let k = avant.length - 1;
    r1 = avant[k];
    while ((r2.date.getTime() - r1.date.getTime()) / JOUR_MS < FENETRE_MIN_J && k > 0) {
      k--;
      r1 = avant[k];
    }
    if (k < avant.length - 1) drapeaux.push('fenêtre élargie');
  } else {
    // Pas d'antériorité (site nouveau) : fenêtre intra-mois, dégradée.
    if (duMois.length < 2) return null;
    r1 = duMois[0];
    drapeaux.push('fenêtre intra-mois');
  }
  const fenetreJours = (r2.date.getTime() - r1.date.getTime()) / JOUR_MS;
  if (fenetreJours < 1) return null;
  if (fenetreJours < FENETRE_MIN_J) drapeaux.push(`fenêtre courte (${Math.round(fenetreJours)} j)`);

  const livFenetre = sommeLivraisons(opts.livraisons, r1.date, r2.date);
  const consoFenetre = r1.volume! + livFenetre - r2.volume!;
  let consoJour: number | null = null;
  if (consoFenetre >= 0) consoJour = consoFenetre / fenetreJours;
  else drapeaux.push('conso négative - jauge ou livraison à vérifier');
  const conso = consoJour != null ? consoJour * nbJours : null;

  // L/h de la fenêtre + contre-épreuve heures × débit lissé.
  let debitLh: number | null = null;
  let gasoilInexplique: number | null = null;
  const heures = heuresFenetre(opts.releves, r1.date, r2.date);
  if (heures != null && heures > 0 && consoFenetre > 0) {
    const brut = consoFenetre / heures;
    if (brut >= 0.5 && brut <= 60) debitLh = brut;
    else drapeaux.push('index incohérent avec la conso - à vérifier');
    const lisse = debitLisse(opts.releves, opts.livraisons);
    if (lisse != null && conso != null) {
      const attendu = (lisse * heures / fenetreJours) * nbJours;
      const ecart = conso - attendu;
      if (ecart > 200 && conso > 1.5 * attendu) {
        gasoilInexplique = Math.round(ecart);
        drapeaux.push('gasoil non expliqué par la marche du GE');
      }
    }
  }

  // Stocks aux frontières, interpolés par la conso/j (report brut à défaut, signalé).
  const interp = consoJour ?? 0;
  if (consoJour == null) drapeaux.push('frontières en report brut (conso incalculable)');
  const jAvant = Math.max(0, (premier.getTime() - r1.date.getTime()) / JOUR_MS);
  const stockDebut = r1.date < premier
    ? Math.max(0, r1.volume! - interp * jAvant + sommeLivraisons(opts.livraisons, r1.date, premier))
    : r1.volume!;
  const jApres = Math.max(0, (suivant.getTime() - r2.date.getTime()) / JOUR_MS);
  const stockFin = Math.max(0, r2.volume! - interp * jApres + sommeLivraisons(opts.livraisons, r2.date, suivant));

  return {
    stockDebut: Math.round(stockDebut),
    stockFin: Math.round(stockFin),
    livraisons: Math.round(sommeLivraisons(opts.livraisons, premier, suivant)),
    conso: conso != null ? Math.round(conso) : null,
    consoJour: consoJour != null ? Math.round(consoJour * 10) / 10 : null,
    debitLh: debitLh != null ? Math.round(debitLh * 100) / 100 : null,
    gasoilInexplique,
    fenetreJours: Math.round(fenetreJours),
    drapeaux,
  };
}

/** Charge les données et déroule la méthode sur tout le parc pour (annee, mois). */
export async function stocksMensuels(opts: { annee: number; mois: number; region?: string }): Promise<LigneStockMensuel[]> {
  const suivant = new Date(Date.UTC(opts.annee, opts.mois, 1));
  const sites = await prisma.site.findMany({
    where: { isActive: true, ...(opts.region ? { region: opts.region } : {}) },
    select: { id: true, nom: true, region: true },
  });
  const ids = sites.map((s) => s.id);
  // Toute l'antériorité disponible : le débit lissé et la fenêtre élargie en vivent.
  const [releves, depots] = await Promise.all([
    prisma.releveEnergie.findMany({
      where: { siteId: { in: ids }, source: 'GE', dateReleve: { lt: suivant } },
      select: { siteId: true, dateReleve: true, volumeGasoilLitres: true, indexHeuresGE: true, groupeId: true },
      orderBy: { dateReleve: 'asc' },
    }),
    prisma.depotage.findMany({
      where: { siteId: { in: ids }, dateDepotage: { lt: suivant } },
      select: { siteId: true, dateDepotage: true, volumeLitres: true },
    }),
  ]);
  const relParSite = new Map<string, ReleveStockLite[]>();
  for (const r of releves) {
    const arr = relParSite.get(r.siteId) ?? [];
    arr.push({
      date: r.dateReleve,
      volume: r.volumeGasoilLitres != null ? Number(r.volumeGasoilLitres) : null,
      index: r.indexHeuresGE != null ? Number(r.indexHeuresGE) : null,
      groupeId: r.groupeId,
    });
    relParSite.set(r.siteId, arr);
  }
  const livParSite = new Map<string, LivraisonLite[]>();
  for (const d of depots) {
    const arr = livParSite.get(d.siteId) ?? [];
    arr.push({ date: d.dateDepotage, litres: Number(d.volumeLitres) });
    livParSite.set(d.siteId, arr);
  }

  const out: LigneStockMensuel[] = [];
  for (const s of sites) {
    const bilan = bilanMensuelSite({
      releves: relParSite.get(s.id) ?? [],
      livraisons: livParSite.get(s.id) ?? [],
      annee: opts.annee,
      mois: opts.mois,
    });
    if (bilan) out.push({ siteId: s.id, site: s.nom, region: s.region, ...bilan });
  }
  return out.sort((a, b) => a.site.localeCompare(b.site));
}
