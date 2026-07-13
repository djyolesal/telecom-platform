import { prisma } from '../config/database';
import { getNum } from './settings.service';
import { GE_PARAMS } from '../utils/calculator';

/**
 * Détection des pertes/vols de carburant par site, à partir des écarts DÉJÀ
 * calculés et stockés à chaque dépotage (aucun nouveau relevé nécessaire) :
 *
 *  - ecartConsoLitres > 0  → surconsommation : la cuve a baissé PLUS que ce que
 *    le GE a pu brûler (heures × puissance) → gasoil disparu hors combustion
 *    (siphonnage de cuve, fuite, ou heures GE sous-déclarées).
 *  - ecartLivraisonLitres < 0 → manquant livraison : moins de gasoil est réellement
 *    entré en cuve que ce qui a été annoncé/facturé (détournement au camion).
 *
 * Le score combine l'intensité des pertes (rapportée au volume livré) et leur
 * récurrence, pour hiérarchiser les sites à contrôler en priorité.
 */
export interface SiteAnomalieCarburant {
  siteId: string;
  code: string;
  nom: string;
  region: string;
  nbDepotages: number;
  nbAnomalies: number;
  tauxAnomalie: number; // part des dépotages présentant une anomalie
  volumeLivreLitres: number;
  perteSurconsoLitres: number;   // gasoil disparu vs combustion attendue
  perteLivraisonLitres: number;  // gasoil facturé mais non entré en cuve
  perteTotaleLitres: number;
  perteFCFA: number;
  score: number; // 0..100
  niveau: 'OK' | 'A_SURVEILLER' | 'SUSPECT' | 'CRITIQUE';
  facteurs: string[];
}

function niveauFromScore(score: number): SiteAnomalieCarburant['niveau'] {
  if (score >= 60) return 'CRITIQUE';
  if (score >= 35) return 'SUSPECT';
  if (score >= 15) return 'A_SURVEILLER';
  return 'OK';
}

/**
 * Calcule le score d'anomalie carburant par site sur une fenêtre glissante.
 * @param jours fenêtre d'analyse (défaut 90).
 */
export async function detectFuelAnomalies(opts: { jours?: number } = {}): Promise<SiteAnomalieCarburant[]> {
  const jours = opts.jours && opts.jours > 0 ? opts.jours : 90;
  const depuis = new Date(Date.now() - jours * 86400000);
  const prixLitre = getNum('ge.prixLitreFCFA', GE_PARAMS.prixLitreFCFA);
  // Plancher anti-bruit : sous ce volume, un écart est imputé à l'imprécision de
  // jauge, pas à une anomalie (configurable).
  const seuilBruit = getNum('carburant.seuilAnomalieLitres', 20);

  const depotages = await prisma.depotage.findMany({
    where: { dateDepotage: { gte: depuis } },
    select: {
      siteId: true,
      volumeLitres: true,
      ecartConsoLitres: true,
      ecartLivraisonLitres: true,
      site: { select: { code: true, nom: true, region: true } },
    },
  });

  type Acc = Omit<SiteAnomalieCarburant, 'tauxAnomalie' | 'perteTotaleLitres' | 'perteFCFA' | 'score' | 'niveau' | 'facteurs'>;
  const parSite = new Map<string, Acc>();

  for (const d of depotages) {
    const acc = parSite.get(d.siteId) ?? {
      siteId: d.siteId,
      code: d.site?.code ?? '?',
      nom: d.site?.nom ?? '?',
      region: d.site?.region ?? '—',
      nbDepotages: 0,
      nbAnomalies: 0,
      volumeLivreLitres: 0,
      perteSurconsoLitres: 0,
      perteLivraisonLitres: 0,
    };
    acc.nbDepotages += 1;
    acc.volumeLivreLitres += Number(d.volumeLitres);

    const surconso = d.ecartConsoLitres != null ? Number(d.ecartConsoLitres) : 0;   // > 0 = suspect
    const manqueLiv = d.ecartLivraisonLitres != null ? Number(d.ecartLivraisonLitres) : 0; // < 0 = suspect
    let anomalie = false;
    if (surconso > seuilBruit) { acc.perteSurconsoLitres += surconso; anomalie = true; }
    if (manqueLiv < -seuilBruit) { acc.perteLivraisonLitres += -manqueLiv; anomalie = true; }
    if (anomalie) acc.nbAnomalies += 1;

    parSite.set(d.siteId, acc);
  }

  const out: SiteAnomalieCarburant[] = [];
  for (const a of parSite.values()) {
    const perteTotale = a.perteSurconsoLitres + a.perteLivraisonLitres;
    const tauxAnomalie = a.nbDepotages > 0 ? a.nbAnomalies / a.nbDepotages : 0;
    // Intensité = part du gasoil livré qui « disparaît » (borne 1).
    const ratioPerte = a.volumeLivreLitres > 0 ? Math.min(1, perteTotale / a.volumeLivreLitres) : 0;
    // Score : 60 % intensité + 40 % récurrence, atténué si trop peu de dépotages
    // (un seul écart n'est pas une tendance).
    const fiabilite = Math.min(1, a.nbDepotages / 3);
    const score = Math.round(100 * fiabilite * (0.6 * ratioPerte + 0.4 * tauxAnomalie));

    const facteurs: string[] = [];
    if (a.perteSurconsoLitres > 0) {
      facteurs.push(`Surconsommation cumulée : ${Math.round(a.perteSurconsoLitres)} L disparus hors combustion GE.`);
    }
    if (a.perteLivraisonLitres > 0) {
      facteurs.push(`Manquant à la livraison : ${Math.round(a.perteLivraisonLitres)} L facturés mais non entrés en cuve.`);
    }
    if (a.nbAnomalies > 0) {
      facteurs.push(`Récurrence : ${a.nbAnomalies}/${a.nbDepotages} dépotage(s) anormaux sur ${jours} j.`);
    }

    out.push({
      ...a,
      tauxAnomalie,
      perteTotaleLitres: Math.round(perteTotale),
      perteFCFA: Math.round(perteTotale * prixLitre),
      volumeLivreLitres: Math.round(a.volumeLivreLitres),
      perteSurconsoLitres: Math.round(a.perteSurconsoLitres),
      perteLivraisonLitres: Math.round(a.perteLivraisonLitres),
      score,
      niveau: niveauFromScore(score),
      facteurs,
    });
  }

  // Les plus suspects d'abord.
  return out.sort((x, y) => y.score - x.score || y.perteFCFA - x.perteFCFA);
}
