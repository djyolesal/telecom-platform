import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';

const n = (v: unknown): number => (v == null ? 0 : Number(v));
const r0 = (v: number) => Math.round(v);

/**
 * SUIVI DÉTAILLÉ DES COMMANDES CARBURANT SUR UNE PÉRIODE.
 *
 * Un classeur qui suit la chaîne entière, du bon de commande au litre dépoté :
 *   BC → bons de livraison (chargements) → lignes de plan (sites) → dépotages.
 *
 * La période se compte en MOIS, comme le rapprochement trimestriel : un bon de
 * livraison appartient au mois logistique auquel il est rattaché (`mois`,
 * `annee`), pas à sa date de chargement. C'est voulu - sur un trimestre complet,
 * les totaux de ce classeur sont ceux du rapprochement du BC, et les deux
 * documents ne peuvent pas se contredire.
 *
 * Mêmes règles que le rapprochement (services/rapprochement.service.ts) :
 *  - les brouillons et les chargements annulés ne sont pas des chargements réels ;
 *  - le chargé inclut les reports reçus d'un autre camion ;
 *  - un dépotage HORS PLAN (sans ligne de plan) est rattaché au BC qui couvre son
 *    mois. Si aucun BC, ou plusieurs, couvrent ce mois, il reste « non rattaché »
 *    plutôt que d'être attribué au hasard ;
 *  - l'avoir fournisseur porte sur la COMMANDE entière, pas sur un mois : il
 *    n'est déduit que si la période couvre tout le BC.
 */

export interface PeriodeMois { debut: { annee: number; mois: number }; fin: { annee: number; mois: number } }

const indice = (annee: number, mois: number) => annee * 12 + (mois - 1);
export const MOIS_MAX = 24;

/** « 2026-07 » → { annee: 2026, mois: 7 } ; refus explicite sinon. */
function moisDe(brut: unknown, nom: string): { annee: number; mois: number } {
  const m = typeof brut === 'string' ? brut.trim().match(/^(\d{4})-(\d{1,2})$/) : null;
  const mois = m ? Number(m[2]) : 0;
  if (!m || mois < 1 || mois > 12) throw new AppError(`${nom} invalide : AAAA-MM attendu (ex. 2026-07).`, 422);
  return { annee: Number(m[1]), mois };
}

export function lirePeriode(du: unknown, au: unknown): PeriodeMois {
  const debut = moisDe(du, 'Mois de début');
  const fin = moisDe(au, 'Mois de fin');
  const ecart = indice(fin.annee, fin.mois) - indice(debut.annee, debut.mois);
  if (ecart < 0) throw new AppError('Le mois de fin précède le mois de début.', 422);
  if (ecart >= MOIS_MAX) throw new AppError(`Période trop longue : ${MOIS_MAX} mois au plus.`, 422);
  return { debut, fin };
}

export const dansPeriode = (p: PeriodeMois, annee: number, mois: number) => {
  const i = indice(annee, mois);
  return i >= indice(p.debut.annee, p.debut.mois) && i <= indice(p.fin.annee, p.fin.mois);
};

/** Bornes de dates de la période : [1er du mois de début, 1er du mois après la fin[. */
export const bornes = (p: PeriodeMois) => ({
  debut: new Date(Date.UTC(p.debut.annee, p.debut.mois - 1, 1)),
  fin: new Date(Date.UTC(p.fin.annee, p.fin.mois, 1)),
});

// ── Données chargées (forme minimale, pour que le calcul reste testable) ──

export interface SiteLite { id: string; code: string; nom: string; region: string }
export interface DepotageLite {
  id: string; reference: string | null; dateDepotage: Date; volumeLitres: unknown;
  volumeAnnonceLitres: unknown; ecartLivraisonLitres: unknown;
  stockAvantLitres: unknown; stockApresLitres: unknown;
  nomChauffeur: string | null; technicien: { nom: string; prenom: string } | null;
  site: SiteLite;
}
export interface LigneLite {
  id: string; volumePrevuLitres: unknown; statut: string; pickup: boolean | null;
  site: SiteLite & { accesPickup?: boolean | null };
  depotages: DepotageLite[];
}
export interface BlLite {
  id: string; numeroBL: string; mois: number; annee: number; statut: string;
  dateChargement: Date; dateTraitement: Date | null; dateCloture: Date | null;
  immatriculation: string; volumeChargeLitres: unknown;
  resteRetourDepotLitres: unknown; restePerteLitres: unknown; resteReportLitres: unknown;
  transporteur: { nom: string } | null; chauffeur: { nom: string } | null;
  reportsRecus: Array<{ resteReportLitres: unknown }>;
  bonCommandeId: string;
  lignes: LigneLite[];
}
export interface BcLite {
  id: string; numero: string; annee: number; trimestre: number; statut: string;
  volumesMensuels: Array<{ mois: number; volumePrevuLitres: unknown }>;
}

/** Mois couverts par un BC : ses volumes mensuels, à défaut son trimestre plein. */
export function moisDuBc(bc: BcLite): number[] {
  if (bc.volumesMensuels.length) return bc.volumesMensuels.map((v) => v.mois).sort((a, b) => a - b);
  return [1, 2, 3].map((k) => (bc.trimestre - 1) * 3 + k);
}

export interface SuiviCommandes {
  syntheses: Array<{
    bcId: string; numero: string; trimestre: string; statut: string;
    couverture: string; complet: boolean;
    commande: number; charge: number; planifie: number; livrePlan: number; livreHorsPlan: number;
    retourDepot: number; perte: number; report: number; avoirs: number;
    ecartNonExplique: number; nbBl: number; nbBlNonClos: number;
  }>;
  bls: Array<{
    numeroBL: string; bc: string; moisLogistique: string; dateChargement: Date; dateTraitement: Date | null;
    transporteur: string; camion: string; chauffeur: string;
    charge: number; reportRecu: number; planifie: number; livre: number; reste: number;
    nbSites: number; sitesLivres: number; statut: string; dateCloture: Date | null;
    retourDepot: number; perte: number; report: number; ecartNonExplique: number | null;
  }>;
  lignes: Array<{
    numeroBL: string; bc: string; dateChargement: Date; site: string; code: string; region: string;
    pickup: string; prevu: number; livre: number; ecart: number; statut: string;
    nbDepotages: number; premierDepotage: Date | null; dernierDepotage: Date | null;
  }>;
  depotages: Array<{
    date: Date; reference: string; site: string; code: string; region: string; rattachement: string;
    numeroBL: string; bc: string; volume: number; annonce: number | null; ecartAnnonce: number | null;
    stockAvant: number | null; stockApres: number | null; chauffeur: string; technicien: string;
    delaiJours: number | null;
  }>;
  totaux: {
    nbBc: number; nbBl: number; commande: number; charge: number; livrePlan: number; livreHorsPlan: number;
    horsPlanNonRattache: number; ecartNonExplique: number;
  };
}

const LIB_STATUT_BL: Record<string, string> = { PLANIFIE: 'Planifié', CHARGE: 'Chargé', LIVRE: 'Livré', ANNULE: 'Annulé' };
const LIB_STATUT_LIGNE: Record<string, string> = { PREVU: 'Prévu', PARTIEL: 'Partiel', LIVRE: 'Livré', ANNULE: 'Annulé' };
const LIB_STATUT_BC: Record<string, string> = { OUVERT: 'Ouvert', CLOTURE: 'Clôturé', ANNULE: 'Annulé' };
const MOIS = ['', 'janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const nullable = (v: unknown) => (v == null ? null : r0(n(v)));
const nomTech = (t: { nom: string; prenom: string } | null) => (t ? `${t.prenom} ${t.nom}`.trim() : '');

/**
 * Calcul PUR du suivi à partir des données chargées. `bcs` : tous les BC non
 * annulés (pour rattacher les dépotages hors plan), `avoirs` : par id de BC.
 */
export function construireSuivi(
  p: PeriodeMois,
  bcs: BcLite[],
  bls: BlLite[],
  horsPlan: DepotageLite[],
  avoirs: Map<string, number>,
  bcFiltre?: string,
): SuiviCommandes {
  const parId = new Map(bcs.map((b) => [b.id, b]));
  const blsPeriode = bls.filter((b) => dansPeriode(p, b.annee, b.mois) && (!bcFiltre || b.bonCommandeId === bcFiltre));

  // Rattachement d'un dépotage hors plan : le BC (unique) qui couvre son mois.
  const bcDuMois = (annee: number, mois: number): BcLite | null => {
    const candidats = bcs.filter((b) => b.annee === annee && moisDuBc(b).includes(mois));
    return candidats.length === 1 ? candidats[0] : null;
  };
  const horsPlanRattache = horsPlan.map((d) => ({
    d, bc: bcDuMois(d.dateDepotage.getUTCFullYear(), d.dateDepotage.getUTCMonth() + 1),
  })).filter((x) => !bcFiltre || x.bc?.id === bcFiltre);

  // BC présents : ceux d'un chargement de la période, ceux dont un mois de commande y tombe.
  const bcsPresents = bcs.filter((b) =>
    (!bcFiltre || b.id === bcFiltre)
    && (blsPeriode.some((bl) => bl.bonCommandeId === b.id) || moisDuBc(b).some((m) => dansPeriode(p, b.annee, m))));

  const syntheses = bcsPresents
    .sort((a, b) => indice(a.annee, a.trimestre * 3) - indice(b.annee, b.trimestre * 3) || a.numero.localeCompare(b.numero))
    .map((bc) => {
      const mesBls = blsPeriode.filter((bl) => bl.bonCommandeId === bc.id);
      const moisBc = moisDuBc(bc);
      const moisCouverts = moisBc.filter((m) => dansPeriode(p, bc.annee, m));
      const complet = moisCouverts.length === moisBc.length;

      // Cumuls PAR MOIS, arrondis mois par mois puis additionnés : c'est la règle
      // du rapprochement trimestriel. Arrondir le total d'un coup donnait un
      // litre d'écart avec lui - deux documents officiels ne doivent pas différer.
      type Acc = { commande: number; charge: number; planifie: number; livrePlan: number; livreHorsPlan: number; retourDepot: number; perte: number; report: number };
      const parMois = new Map<number, Acc>();
      const acc = (annee: number, mois: number): Acc => {
        const k = indice(annee, mois);
        let a = parMois.get(k);
        if (!a) { a = { commande: 0, charge: 0, planifie: 0, livrePlan: 0, livreHorsPlan: 0, retourDepot: 0, perte: 0, report: 0 }; parMois.set(k, a); }
        return a;
      };
      for (const v of bc.volumesMensuels) if (dansPeriode(p, bc.annee, v.mois)) acc(bc.annee, v.mois).commande += n(v.volumePrevuLitres);
      for (const bl of mesBls) {
        const a = acc(bl.annee, bl.mois);
        a.charge += n(bl.volumeChargeLitres) + bl.reportsRecus.reduce((t, r) => t + n(r.resteReportLitres), 0);
        a.retourDepot += n(bl.resteRetourDepotLitres);
        a.perte += n(bl.restePerteLitres);
        a.report += n(bl.resteReportLitres);
        for (const l of bl.lignes) {
          a.planifie += n(l.volumePrevuLitres);
          a.livrePlan += l.depotages.reduce((u, d) => u + n(d.volumeLitres), 0);
        }
      }
      for (const { d, bc: rattache } of horsPlanRattache) {
        if (rattache?.id !== bc.id) continue;
        acc(d.dateDepotage.getUTCFullYear(), d.dateDepotage.getUTCMonth() + 1).livreHorsPlan += n(d.volumeLitres);
      }
      const mois = [...parMois.values()];
      const total = (k: keyof Acc) => mois.reduce((t, a) => t + r0(a[k]), 0);
      const commande = total('commande'), charge = total('charge'), planifie = total('planifie');
      const livrePlan = total('livrePlan'), livreHorsPlan = total('livreHorsPlan');
      const retourDepot = total('retourDepot'), perte = total('perte'), report = total('report');
      // L'avoir ne se répartit pas par mois : déduit seulement sur le BC entier.
      const avoirsBc = complet ? (avoirs.get(bc.id) ?? 0) : 0;
      const ecart = mois.reduce((t, a) => t + r0(a.charge - a.livrePlan - a.livreHorsPlan - a.retourDepot - a.perte - a.report), 0) - avoirsBc;
      return {
        bcId: bc.id, numero: bc.numero, trimestre: `T${bc.trimestre} ${bc.annee}`,
        statut: LIB_STATUT_BC[bc.statut] ?? bc.statut,
        couverture: complet ? 'Commande entière' : `Partielle (${moisCouverts.length}/${moisBc.length} mois)`,
        complet,
        commande: r0(commande), charge: r0(charge), planifie: r0(planifie),
        livrePlan: r0(livrePlan), livreHorsPlan: r0(livreHorsPlan),
        retourDepot: r0(retourDepot), perte: r0(perte), report: r0(report), avoirs: r0(avoirsBc),
        ecartNonExplique: r0(ecart),
        nbBl: mesBls.length, nbBlNonClos: mesBls.filter((bl) => !bl.dateCloture).length,
      };
    });

  const numeroBc = (id: string) => parId.get(id)?.numero ?? '';

  const blsTries = [...blsPeriode].sort((a, b) => a.dateChargement.getTime() - b.dateChargement.getTime() || a.numeroBL.localeCompare(b.numeroBL));
  const lignesBl = blsTries.map((bl) => {
    const reportRecu = bl.reportsRecus.reduce((t, r) => t + n(r.resteReportLitres), 0);
    const charge = n(bl.volumeChargeLitres);
    const livre = bl.lignes.reduce((t, l) => t + l.depotages.reduce((u, d) => u + n(d.volumeLitres), 0), 0);
    const reste = charge + reportRecu - livre;
    const retour = n(bl.resteRetourDepotLitres), perte = n(bl.restePerteLitres), report = n(bl.resteReportLitres);
    return {
      numeroBL: bl.numeroBL, bc: numeroBc(bl.bonCommandeId),
      moisLogistique: `${MOIS[bl.mois]} ${bl.annee}`,
      dateChargement: bl.dateChargement, dateTraitement: bl.dateTraitement,
      transporteur: bl.transporteur?.nom ?? '', camion: bl.immatriculation, chauffeur: bl.chauffeur?.nom ?? '',
      charge: r0(charge), reportRecu: r0(reportRecu),
      planifie: r0(bl.lignes.reduce((t, l) => t + n(l.volumePrevuLitres), 0)),
      livre: r0(livre), reste: r0(reste),
      nbSites: bl.lignes.length, sitesLivres: bl.lignes.filter((l) => l.depotages.length > 0).length,
      statut: LIB_STATUT_BL[bl.statut] ?? bl.statut, dateCloture: bl.dateCloture,
      retourDepot: r0(retour), perte: r0(perte), report: r0(report),
      // Sans clôture, le reste n'est pas encore ventilé : l'écart n'existe pas encore.
      ecartNonExplique: bl.dateCloture ? r0(reste - retour - perte - report) : null,
    };
  });

  const lignes = blsTries.flatMap((bl) => bl.lignes.map((l) => {
    const dates = l.depotages.map((d) => d.dateDepotage.getTime()).sort((a, b) => a - b);
    const prevu = n(l.volumePrevuLitres);
    const livre = l.depotages.reduce((u, d) => u + n(d.volumeLitres), 0);
    const pickup = l.pickup ?? l.site.accesPickup ?? false;
    return {
      numeroBL: bl.numeroBL, bc: numeroBc(bl.bonCommandeId), dateChargement: bl.dateChargement,
      site: l.site.nom, code: l.site.code, region: l.site.region, pickup: pickup ? 'Oui' : '',
      prevu: r0(prevu), livre: r0(livre), ecart: r0(livre - prevu),
      statut: LIB_STATUT_LIGNE[l.statut] ?? l.statut, nbDepotages: l.depotages.length,
      premierDepotage: dates.length ? new Date(dates[0]) : null,
      dernierDepotage: dates.length ? new Date(dates[dates.length - 1]) : null,
    };
  }));

  const ligneDepotage = (d: DepotageLite, rattachement: string, bl: BlLite | null, bc: string) => ({
    date: d.dateDepotage, reference: d.reference ?? '', site: d.site.nom, code: d.site.code, region: d.site.region,
    rattachement, numeroBL: bl?.numeroBL ?? '', bc,
    volume: r0(n(d.volumeLitres)), annonce: nullable(d.volumeAnnonceLitres), ecartAnnonce: nullable(d.ecartLivraisonLitres),
    stockAvant: nullable(d.stockAvantLitres), stockApres: nullable(d.stockApresLitres),
    chauffeur: d.nomChauffeur ?? '', technicien: nomTech(d.technicien),
    // Du chargement au dépotage : la donnée qui dit combien de temps le gasoil a voyagé.
    delaiJours: bl ? Math.round(((d.dateDepotage.getTime() - bl.dateChargement.getTime()) / 86_400_000) * 10) / 10 : null,
  });
  const depotages = [
    ...blsTries.flatMap((bl) => bl.lignes.flatMap((l) => l.depotages.map((d) => ligneDepotage(d, 'Au plan', bl, numeroBc(bl.bonCommandeId))))),
    ...horsPlanRattache.map(({ d, bc }) => ligneDepotage(d, bc ? 'Hors plan' : 'Hors plan, non rattaché', null, bc?.numero ?? '')),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());

  const somme = (k: 'commande' | 'charge' | 'livrePlan' | 'livreHorsPlan' | 'ecartNonExplique') => syntheses.reduce((s, x) => s + x[k], 0);
  return {
    syntheses, bls: lignesBl, lignes, depotages,
    totaux: {
      nbBc: syntheses.length, nbBl: blsPeriode.length,
      commande: somme('commande'), charge: somme('charge'),
      livrePlan: somme('livrePlan'), livreHorsPlan: somme('livreHorsPlan'),
      horsPlanNonRattache: r0(horsPlanRattache.filter((x) => !x.bc).reduce((s, x) => s + n(x.d.volumeLitres), 0)),
      ecartNonExplique: somme('ecartNonExplique'),
    },
  };
}

const SELECT_DEPOTAGE = {
  id: true, reference: true, dateDepotage: true, volumeLitres: true, volumeAnnonceLitres: true,
  ecartLivraisonLitres: true, stockAvantLitres: true, stockApresLitres: true, nomChauffeur: true,
  technicien: { select: { nom: true, prenom: true } },
  site: { select: { id: true, code: true, nom: true, region: true } },
} as const;

/** Charge la période et calcule le suivi. */
export async function suiviCommandes(p: PeriodeMois, bcFiltre?: string): Promise<SuiviCommandes> {
  const { debut, fin } = bornes(p);
  const [bcs, bls, horsPlan] = await Promise.all([
    prisma.bonCommande.findMany({
      where: { statut: { not: 'ANNULE' } },
      select: { id: true, numero: true, annee: true, trimestre: true, statut: true, volumesMensuels: { select: { mois: true, volumePrevuLitres: true } } },
    }),
    prisma.bonLivraison.findMany({
      // Les années bornent la requête ; le mois exact est filtré au calcul.
      where: {
        isBrouillon: false, statut: { not: 'ANNULE' },
        annee: { gte: p.debut.annee, lte: p.fin.annee },
        ...(bcFiltre ? { bonCommandeId: bcFiltre } : {}),
      },
      select: {
        id: true, numeroBL: true, mois: true, annee: true, statut: true, bonCommandeId: true,
        dateChargement: true, dateTraitement: true, dateCloture: true, immatriculation: true, volumeChargeLitres: true,
        resteRetourDepotLitres: true, restePerteLitres: true, resteReportLitres: true,
        transporteur: { select: { nom: true } }, chauffeur: { select: { nom: true } },
        reportsRecus: { select: { resteReportLitres: true } },
        lignes: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true, volumePrevuLitres: true, statut: true, pickup: true,
            site: { select: { id: true, code: true, nom: true, region: true, accesPickup: true } },
            depotages: { select: SELECT_DEPOTAGE, orderBy: { dateDepotage: 'asc' } },
          },
        },
      },
    }),
    prisma.depotage.findMany({
      where: { ligneLivraisonId: null, dateDepotage: { gte: debut, lt: fin } },
      select: SELECT_DEPOTAGE,
    }),
  ]);
  if (bcFiltre && !bcs.some((b) => b.id === bcFiltre)) throw new AppError('Bon de commande introuvable.', 404);

  const avoirs = await prisma.mouvementCarburant.groupBy({
    by: ['bonCommandeId'],
    where: { type: 'AVOIR_FOURNISSEUR', statut: 'VALIDE', bonCommandeId: { not: null } },
    _sum: { volumeLitres: true },
  });
  const parBc = new Map(avoirs.map((a) => [a.bonCommandeId as string, n(a._sum.volumeLitres)]));

  return construireSuivi(p, bcs as BcLite[], bls as unknown as BlLite[], horsPlan as unknown as DepotageLite[], parBc, bcFiltre);
}
