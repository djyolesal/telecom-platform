import { prisma } from '../config/database';
import { litresParHeureGE } from '../utils/calculator';
import { geParams } from './settings.service';
import { memo } from '../utils/memo';
import { signeMouvement, avoirsBonCommande } from './mouvementsCarburant.service';

const n = (v: unknown): number => (v == null ? 0 : Number(v));
const r0 = (v: number) => Math.round(v);

/**
 * RAPPROCHEMENT TRIMESTRIEL PAR BON DE COMMANDE — l'artefact qui répond en une
 * page à « où est passé le carburant du trimestre ? ».
 *
 * Jusqu'ici les cinq chiffres du trimestre vivaient dans cinq écrans différents
 * et n'étaient jamais additionnés : commandé et chargé étaient bons, livré était
 * sous-estimé (les dépotages hors plan n'étaient comptés nulle part), consommé
 * n'existait pas par trimestre, et les pertes n'étaient jamais consolidées.
 * L'équation de conservation — stock_début + livré − consommé = stock_fin —
 * n'était écrite nulle part.
 *
 * Deux blocs :
 *  1. VOLET LOGISTIQUE, par mois : commandé | chargé | planifié | livré (dont
 *     hors plan) | retour dépôt | perte | report | écart non expliqué.
 *     L'écart non expliqué est ce qui est monté dans le camion et dont personne
 *     ne sait dire où il est allé — c'est LA colonne à lire.
 *  2. VOLET PHYSIQUE, par site : stock de début, livré, stock de fin, d'où se
 *     déduit la consommation réelle, confrontée à la consommation théorique
 *     (heures compteur × débit) quand elle est mesurable.
 *
 * Rien n'est deviné : un site sans relevé de cuve aux deux bornes est marqué
 * « non mesuré » plutôt que compté à zéro — un stock supposé nul créerait une
 * consommation fantôme du volume de la cuve.
 */

export interface LigneMoisRapprochement {
  mois: number;
  commande: number;
  charge: number;
  planifie: number;
  livrePlan: number;
  livreHorsPlan: number;
  livreTotal: number;
  retourDepot: number;
  perte: number;
  report: number;
  ecartNonExplique: number;
  nbBl: number;
  nbBlNonClos: number;
}

export interface LigneSiteConservation {
  siteId: string; siteCode: string; siteNom: string; region: string;
  stockDebut: number | null;
  stockFin: number | null;
  livre: number;
  mouvements: number;              // transferts entrants − sortants − purges
  consoReelle: number | null;      // stockDébut + livré − stockFin
  consoTheorique: number | null;   // heures compteur × débit L/h des GE actifs
  ecart: number | null;            // réelle − théorique (surconsommation si > 0)
  mesure: boolean;                 // les deux bornes de jauge existent
  motifNonMesure: string | null;
}

export function rapprochementBc(bonCommandeId: string) {
  return memo(`rapprochement:${bonCommandeId}`, 60_000, () => rapprochementBcImpl(bonCommandeId));
}

async function rapprochementBcImpl(bonCommandeId: string) {
  const bc = await prisma.bonCommande.findUnique({
    where: { id: bonCommandeId },
    include: { volumesMensuels: { orderBy: { mois: 'asc' } } },
  });
  if (!bc) return null;

  // Bornes du trimestre : les mois du BC s'il en porte, sinon le trimestre plein
  // (un BC sans volume mensuel resterait sinon sans période, donc sans rapport).
  const moisBc = bc.volumesMensuels.map((v) => v.mois);
  const moisMin = moisBc.length ? Math.min(...moisBc) : (bc.trimestre - 1) * 3 + 1;
  const moisMax = moisBc.length ? Math.max(...moisBc) : bc.trimestre * 3;
  const debut = new Date(Date.UTC(bc.annee, moisMin - 1, 1));
  const fin = new Date(Date.UTC(bc.annee, moisMax, 1)); // exclusive

  const bls = await prisma.bonLivraison.findMany({
    where: { bonCommandeId, isBrouillon: false, statut: { not: 'ANNULE' } },
    include: {
      // Report reçu d'un autre chargement : ces litres sont dans cette citerne.
      reportsRecus: { select: { resteReportLitres: true } },
      lignes: {
        include: {
          site: { select: { id: true, code: true, nom: true, region: true } },
          depotages: { select: { volumeLitres: true } },
        },
      },
    },
  });

  // Dépotages HORS PLAN de la période : jamais comptés jusqu'ici alors que le
  // carburant est bien entré en cuve — c'est la principale sous-estimation du
  // « livré ». Rattachés au mois de leur date, donc au BC qui couvre ce mois.
  const horsPlan = await prisma.depotage.findMany({
    where: { ligneLivraisonId: null, dateDepotage: { gte: debut, lt: fin } },
    select: { siteId: true, dateDepotage: true, volumeLitres: true, site: { select: { code: true, nom: true, region: true } } },
  });

  // Avoir fournisseur : volume repris sur la commande. Il ne touche aucune cuve
  // mais corrige ce que la commande a réellement coûté, donc il vient en
  // déduction du chargé — sinon le trimestre affiche un écart non expliqué
  // exactement égal au volume repris.
  const avoirs = await avoirsBonCommande(bonCommandeId);

  type Acc = Omit<LigneMoisRapprochement, 'mois' | 'livreTotal' | 'ecartNonExplique'>;
  const vide = (): Acc => ({
    commande: 0, charge: 0, planifie: 0, livrePlan: 0, livreHorsPlan: 0,
    retourDepot: 0, perte: 0, report: 0, nbBl: 0, nbBlNonClos: 0,
  });
  const parMois = new Map<number, Acc>();
  for (let m = moisMin; m <= moisMax; m++) parMois.set(m, vide());
  for (const v of bc.volumesMensuels) {
    const a = parMois.get(v.mois) ?? vide();
    a.commande += n(v.volumePrevuLitres);
    parMois.set(v.mois, a);
  }

  // Volumes livrés par site sur la période (plan + hors plan) pour le volet physique.
  const livreParSite = new Map<string, number>();
  const sitesVus = new Map<string, { code: string; nom: string; region: string }>();

  for (const bl of bls) {
    const a = parMois.get(bl.mois) ?? vide();
    a.charge += n(bl.volumeChargeLitres) + bl.reportsRecus.reduce((t, r) => t + n(r.resteReportLitres), 0);
    a.nbBl++;
    if (!bl.dateCloture) a.nbBlNonClos++;
    a.retourDepot += n(bl.resteRetourDepotLitres);
    a.perte += n(bl.restePerteLitres);
    a.report += n(bl.resteReportLitres);
    for (const l of bl.lignes) {
      a.planifie += n(l.volumePrevuLitres);
      const livre = l.depotages.reduce((s, d) => s + n(d.volumeLitres), 0);
      a.livrePlan += livre;
      livreParSite.set(l.siteId, (livreParSite.get(l.siteId) ?? 0) + livre);
      sitesVus.set(l.siteId, { code: l.site.code, nom: l.site.nom, region: l.site.region });
    }
    parMois.set(bl.mois, a);
  }

  for (const d of horsPlan) {
    const m = d.dateDepotage.getUTCMonth() + 1;
    const a = parMois.get(m);
    if (a) a.livreHorsPlan += n(d.volumeLitres);
    livreParSite.set(d.siteId, (livreParSite.get(d.siteId) ?? 0) + n(d.volumeLitres));
    sitesVus.set(d.siteId, { code: d.site.code, nom: d.site.nom, region: d.site.region });
  }

  const lignesMois: LigneMoisRapprochement[] = [...parMois.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([mois, a]) => {
      const livreTotal = a.livrePlan + a.livreHorsPlan;
      return {
        mois,
        commande: r0(a.commande), charge: r0(a.charge), planifie: r0(a.planifie),
        livrePlan: r0(a.livrePlan), livreHorsPlan: r0(a.livreHorsPlan), livreTotal: r0(livreTotal),
        retourDepot: r0(a.retourDepot), perte: r0(a.perte), report: r0(a.report),
        // Ce que le camion a emporté et que personne n'explique. Le report est
        // déduit : ces litres repartent sur un autre chargement, ils ne sont pas
        // perdus (ils seront comptés à l'arrivée).
        ecartNonExplique: r0(a.charge - livreTotal - a.retourDepot - a.perte - a.report),
        nbBl: a.nbBl, nbBlNonClos: a.nbBlNonClos,
      };
    });

  // L'avoir porte sur la COMMANDE, pas sur un chargement daté : l'imputer au
  // premier mois pouvait afficher un « chargé » négatif quand ce mois ne portait
  // aucun chargement. Il est donc exposé à part et déduit des seuls TOTAUX.

  const conservation = await conservationParSite([...sitesVus.entries()], livreParSite, debut, fin);

  const somme = <K extends keyof LigneMoisRapprochement>(k: K) =>
    lignesMois.reduce((s, l) => s + (l[k] as number), 0);
  // Le volume repris n'est jamais entré dans une cuve : il sort du chargé et,
  // mécaniquement, de l'écart non expliqué du trimestre.
  const chargeNet = somme('charge') - avoirs;
  const ecartNet = somme('ecartNonExplique') - avoirs;

  return {
    bc: { id: bc.id, numero: bc.numero, annee: bc.annee, trimestre: bc.trimestre, statut: bc.statut },
    periode: { debut: debut.toISOString(), fin: fin.toISOString(), moisMin, moisMax },
    lignesMois,
    conservation,
    avoirsLitres: r0(avoirs),
    totaux: {
      commande: somme('commande'), charge: r0(chargeNet), chargeBrut: somme('charge'), planifie: somme('planifie'),
      livrePlan: somme('livrePlan'), livreHorsPlan: somme('livreHorsPlan'), livreTotal: somme('livreTotal'),
      retourDepot: somme('retourDepot'), perte: somme('perte'), report: somme('report'),
      ecartNonExplique: r0(ecartNet),
      nbBl: somme('nbBl'), nbBlNonClos: somme('nbBlNonClos'),
      nbSites: conservation.length,
      nbSitesMesures: conservation.filter((c) => c.mesure).length,
      consoReelleLitres: r0(conservation.reduce((s, c) => s + (c.consoReelle ?? 0), 0)),
    },
  };
}

/**
 * Équation de conservation par site sur la période :
 *   stock_début + livré − consommé = stock_fin
 * d'où consommé = stock_début + livré − stock_fin. Confrontée à la consommation
 * théorique (heures de marche du compteur × débit L/h des GE actifs) quand les
 * deux bornes portent un index horaire.
 */
async function conservationParSite(
  sites: [string, { code: string; nom: string; region: string }][],
  livreParSite: Map<string, number>,
  debut: Date,
  fin: Date
): Promise<LigneSiteConservation[]> {
  if (!sites.length) return [];
  const ids = sites.map(([id]) => id);

  // Jauge et compteur horaire aux deux bornes : dernier relevé GE ≤ borne.
  const [avant, apres, groupes, mvts] = await Promise.all([
    prisma.releveEnergie.findMany({
      where: { siteId: { in: ids }, source: 'GE', volumeGasoilLitres: { not: null }, dateReleve: { lte: debut } },
      orderBy: [{ siteId: 'asc' }, { dateReleve: 'desc' }],
      distinct: ['siteId'],
      select: { siteId: true, volumeGasoilLitres: true, indexHeuresGE: true },
    }),
    prisma.releveEnergie.findMany({
      where: { siteId: { in: ids }, source: 'GE', volumeGasoilLitres: { not: null }, dateReleve: { lt: fin } },
      orderBy: [{ siteId: 'asc' }, { dateReleve: 'desc' }],
      distinct: ['siteId'],
      select: { siteId: true, volumeGasoilLitres: true, indexHeuresGE: true },
    }),
    prisma.groupeElectrogene.findMany({
      where: { siteId: { in: ids }, isActive: true },
      select: { siteId: true, puissanceKva: true, statut: true },
    }),
    // Transferts et purges de la période : du carburant sort de la cuve sans
    // être brûlé. Sans les retirer, ils ressortiraient en surconsommation —
    // c'est-à-dire en soupçon de vol sur un site qui a simplement dépanné un
    // voisin.
    prisma.mouvementCarburant.findMany({
      where: {
        siteId: { in: ids },
        dateMouvement: { gt: debut, lte: fin },
        type: { in: ['TRANSFERT_SORTIE', 'TRANSFERT_ENTREE', 'PURGE'] },
      },
      select: { siteId: true, type: true, volumeLitres: true },
    }),
  ]);
  const mvtParSite = new Map<string, number>();
  for (const m of mvts) {
    if (!m.siteId) continue;
    mvtParSite.set(m.siteId, (mvtParSite.get(m.siteId) ?? 0) + signeMouvement(m.type) * n(m.volumeLitres));
  }

  const gp = geParams();
  const debitParSite = new Map<string, number>();
  for (const g of groupes) {
    // `siteId` est nullable (GE déposé au dépôt) : la requête le filtre déjà,
    // mais TypeScript l'ignore — et un GE sans site ne consomme sur aucun site.
    if (!g.siteId) continue;
    debitParSite.set(g.siteId, (debitParSite.get(g.siteId) ?? 0) + litresParHeureGE(n(g.puissanceKva), g.statut, gp));
  }
  const mAvant = new Map(avant.map((x) => [x.siteId, x]));
  const mApres = new Map(apres.map((x) => [x.siteId, x]));

  return sites
    .map(([siteId, s]) => {
      const a = mAvant.get(siteId);
      const b = mApres.get(siteId);
      const livre = Math.round(livreParSite.get(siteId) ?? 0);
      const stockDebut = a ? n(a.volumeGasoilLitres) : null;
      const stockFin = b ? n(b.volumeGasoilLitres) : null;

      // Les deux bornes doivent être DEUX relevés distincts : si le seul relevé
      // du site est retombé des deux côtés, la « consommation » vaudrait le
      // volume livré — un chiffre faux présenté comme mesuré.
      const mesure = stockDebut != null && stockFin != null && a !== b;
      // stock_début + livré + mouvements − consommé = stock_fin
      const mouvements = Math.round(mvtParSite.get(siteId) ?? 0);
      const consoReelle = mesure ? stockDebut! + livre + mouvements - stockFin! : null;

      let consoTheorique: number | null = null;
      const debit = debitParSite.get(siteId) ?? 0;
      if (mesure && debit > 0 && a?.indexHeuresGE != null && b?.indexHeuresGE != null) {
        const dh = n(b.indexHeuresGE) - n(a.indexHeuresGE);
        if (dh > 0) consoTheorique = Math.round(dh * debit);
      }

      return {
        siteId, siteCode: s.code, siteNom: s.nom, region: s.region,
        stockDebut: stockDebut != null ? Math.round(stockDebut) : null,
        stockFin: stockFin != null ? Math.round(stockFin) : null,
        livre,
        mouvements,
        consoReelle: consoReelle != null ? Math.round(consoReelle) : null,
        consoTheorique,
        ecart: consoReelle != null && consoTheorique != null ? Math.round(consoReelle - consoTheorique) : null,
        mesure,
        motifNonMesure: mesure
          ? null
          : stockDebut == null && stockFin == null
            ? 'Aucun relevé de cuve sur la période'
            : stockDebut == null
              ? 'Pas de relevé avant le début de période'
              : stockFin == null
                ? 'Pas de relevé en fin de période'
                : 'Un seul relevé de cuve sur la période',
      };
    })
    .sort((x, y) => Math.abs(y.ecart ?? 0) - Math.abs(x.ecart ?? 0) || x.siteCode.localeCompare(y.siteCode));
}
