import { detectFuelAnomalies, SiteAnomalieCarburant } from './fuelAnomaly.service';
import { chargerSeries, bilanMensuelSerie } from './stocksMensuels.service';
import { anomaliesCarburantParSite } from './anomaliesCarburantSite.service';
import { prisma } from '../config/database';
import { getNum } from './settings.service';
import { GE_PARAMS } from '../utils/calculator';

/**
 * VERDICT UNIQUE « gasoil non expliqué », par site.
 *
 * Quatre détecteurs répondaient séparément à la même question, avec quatre
 * prémisses différentes : les écarts réconciliés à chaque dépotage, la conso
 * mesurée face au débit habituel du GE, et deux comparaisons au théorique kVA.
 * Rien ne disait lequel faisait foi ; un même site pouvait être « critique »
 * sur un écran et absent d'un autre.
 *
 * Hiérarchie retenue, de la mesure vers l'estimation :
 *
 *  1. BILAN MATIÈRE (méthode validée le 07/09/2026) - ce qui est réellement
 *     sorti de la cuve, confronté aux heures de marche du GE. C'est une
 *     mesure : elle donne le chiffre retenu quand elle existe.
 *  2. ÉCARTS AU DÉPOTAGE - la preuve transactionnelle, livraison par
 *     livraison. Elle prend le relais faute de bilan matière, et sert toujours
 *     de facteur (la récurrence dit beaucoup).
 *  3. THÉORIQUE kVA - un budget, jamais une mesure : il ne devient jamais un
 *     verdict, seulement un facteur d'appui.
 *
 * ET UNE RÈGLE QUI PRIME SUR TOUT : si le site porte des saisies encore à
 * vérifier (jauge au-dessus de la cuve, index GE qui recule, dépotage en
 * double), le verdict passe à A_FIABILISER. On n'accuse pas quelqu'un sur une
 * mesure dont on sait déjà qu'elle est douteuse - on va d'abord fiabiliser la
 * saisie.
 */

export type NiveauVerdict = 'OK' | 'A_SURVEILLER' | 'SUSPECT' | 'CRITIQUE' | 'A_FIABILISER';

export interface VerdictPerteSite {
  siteId: string;
  code: string;
  nom: string;
  region: string;
  /** Le chiffre RETENU, et d'où il vient. */
  litresNonExpliques: number;
  origine: 'BILAN_MATIERE' | 'DEPOTAGES' | 'AUCUNE';
  perteFCFA: number;
  niveau: NiveauVerdict;
  score: number;
  /** Ce qui a pesé, nommé et chiffré - chaque détecteur parle, un seul tranche. */
  facteurs: string[];
  /** Saisies encore à vérifier : elles suspendent le verdict. */
  saisiesSignalees: number;
  /** Détail du détecteur transactionnel, conservé pour la lecture d'exploitation. */
  depotages: { nb: number; anormaux: number; surconso: number; livraison: number };
}

const NIVEAU_PAR_SCORE = (score: number): NiveauVerdict =>
  score >= 60 ? 'CRITIQUE' : score >= 35 ? 'SUSPECT' : score >= 15 ? 'A_SURVEILLER' : 'OK';

/** Les N derniers mois calendaires pleins qui couvrent la fenêtre demandée. */
function moisDeLaFenetre(jours: number): Array<{ annee: number; mois: number }> {
  const out: Array<{ annee: number; mois: number }> = [];
  const fin = new Date();
  const nb = Math.max(1, Math.min(12, Math.round(jours / 30)));
  for (let i = nb; i >= 1; i--) {
    const d = new Date(Date.UTC(fin.getUTCFullYear(), fin.getUTCMonth() - i + 1, 1));
    out.push({ annee: d.getUTCFullYear(), mois: d.getUTCMonth() + 1 });
  }
  return out;
}

export async function verdictPertes(opts: { jours?: number } = {}): Promise<VerdictPerteSite[]> {
  const jours = opts.jours && opts.jours > 0 ? opts.jours : 90;
  const prixLitre = getNum('ge.prixLitreFCFA', GE_PARAMS.prixLitreFCFA);

  const sites = await prisma.site.findMany({
    where: { isActive: true },
    select: { id: true, code: true, nom: true, region: true },
  });
  const ids = sites.map((s) => s.id);
  const mois = moisDeLaFenetre(jours);
  const finFenetre = new Date(Date.UTC(mois[mois.length - 1].annee, mois[mois.length - 1].mois, 1));

  const [depotagesParSite, series, signalees] = await Promise.all([
    detectFuelAnomalies({ jours }).then((l) => new Map(l.map((x) => [x.siteId, x]))),
    chargerSeries(ids, finFenetre),
    anomaliesCarburantParSite({ siteIds: ids }),
  ]);

  const out: VerdictPerteSite[] = [];
  for (const site of sites) {
    const dep: SiteAnomalieCarburant | undefined = depotagesParSite.get(site.id);
    const serie = series.get(site.id);

    // 1. Bilan matière : somme des « non expliqué » des mois de la fenêtre.
    let bilanMatiere = 0;
    let moisMesures = 0;
    for (const m of mois) {
      const b = bilanMensuelSerie(serie, m.annee, m.mois);
      if (!b) continue;
      moisMesures++;
      if (b.gasoilInexplique != null) bilanMatiere += b.gasoilInexplique;
    }

    const facteurs: string[] = [];
    let litres = 0;
    let origine: VerdictPerteSite['origine'] = 'AUCUNE';

    if (moisMesures > 0 && bilanMatiere > 0) {
      litres = bilanMatiere;
      origine = 'BILAN_MATIERE';
      facteurs.push(
        `Bilan matière : ${Math.round(bilanMatiere)} L sortis de la cuve sans marche du GE correspondante `
        + `(${moisMesures} mois mesuré${moisMesures > 1 ? 's' : ''}).`
      );
    } else if (dep && dep.perteTotaleLitres > 0) {
      litres = dep.perteTotaleLitres;
      origine = 'DEPOTAGES';
      facteurs.push(
        moisMesures > 0
          ? 'Bilan matière sans écart : le chiffre retenu vient des écarts réconciliés aux dépotages.'
          : 'Pas de bilan matière calculable (relevés de cuve insuffisants) : chiffre issu des dépotages.'
      );
    }

    // 2. Écarts au dépotage : toujours en facteur, même quand ils ne tranchent pas.
    if (dep) {
      if (dep.perteSurconsoLitres > 0) {
        facteurs.push(`Surconsommation aux dépotages : ${dep.perteSurconsoLitres} L hors combustion GE.`);
      }
      if (dep.perteLivraisonLitres > 0) {
        facteurs.push(`Manquant à la livraison : ${dep.perteLivraisonLitres} L facturés mais non entrés en cuve.`);
      }
      if (dep.nbAnomalies > 0) {
        facteurs.push(`Récurrence : ${dep.nbAnomalies}/${dep.nbDepotages} dépotage(s) anormaux sur ${jours} j.`);
      }
    }

    // Score : celui du détecteur transactionnel, relevé quand le bilan matière
    // confirme - deux prémisses indépendantes qui concordent pèsent plus lourd
    // que l'une des deux seule.
    let score = dep?.score ?? 0;
    if (origine === 'BILAN_MATIERE' && dep && dep.perteTotaleLitres > 0) {
      score = Math.min(100, score + 20);
      facteurs.push('Deux méthodes indépendantes concordent (bilan matière et écarts aux dépotages).');
    } else if (origine === 'BILAN_MATIERE' && score < 15) {
      score = 35; // mesure seule, mais c'est une mesure
    }

    const nbSignalees = signalees.get(site.id)?.nb ?? 0;
    let niveau = NIVEAU_PAR_SCORE(score);
    if (nbSignalees > 0 && (litres > 0 || score > 0)) {
      // ON NE POURSUIT PAS SUR UNE MESURE DOUTEUSE.
      niveau = 'A_FIABILISER';
      facteurs.unshift(
        `${nbSignalees} saisie(s) de ce site attendent vérification : fiabiliser la mesure avant toute conclusion.`
      );
    }

    if (litres <= 0 && score <= 0) continue; // rien à dire sur ce site

    out.push({
      siteId: site.id, code: site.code, nom: site.nom, region: site.region,
      litresNonExpliques: Math.round(litres),
      origine,
      perteFCFA: Math.round(litres * prixLitre),
      niveau, score,
      facteurs,
      saisiesSignalees: nbSignalees,
      depotages: {
        nb: dep?.nbDepotages ?? 0, anormaux: dep?.nbAnomalies ?? 0,
        surconso: dep?.perteSurconsoLitres ?? 0, livraison: dep?.perteLivraisonLitres ?? 0,
      },
    });
  }

  const RANG: Record<NiveauVerdict, number> = { CRITIQUE: 0, SUSPECT: 1, A_FIABILISER: 2, A_SURVEILLER: 3, OK: 4 };
  return out.sort((a, b) => RANG[a.niveau] - RANG[b.niveau] || b.litresNonExpliques - a.litresNonExpliques);
}
