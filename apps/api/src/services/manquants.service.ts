import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { getNum } from './settings.service';
import { memo } from '../utils/memo';

const n = (v: unknown): number => (v == null ? 0 : Number(v));
const EPS = 0.5; // tolérance litres

export interface ManquantsFilter {
  bonCommandeId?: string;
  mois?: number;
  annee?: number;
  // Filtre régional : ne s'applique qu'à la maille SITE (seule proprement
  // attribuable à une région). Les niveaux camion / mois / BC restent nationaux,
  // car un camion ou une commande traversent plusieurs régions.
  region?: string;
}

export interface LigneEnRetard {
  siteCode: string; siteNom: string; region: string;
  numeroBL: string; bcNumero: string;
  dateChargement: Date; jours: number;
  prevu: number; livre: number; manquant: number;
  critique: boolean; // manquant ≥ seuil critique → alerte immédiate
}

export interface CamionCritique {
  numeroBL: string; bcNumero: string; immatriculation: string; transporteur: string | null;
  charge: number; distribue: number; manquant: number; jours: number;
}

/**
 * Calcule les manquants de livraison à 4 niveaux (site, camion, mois, bon de
 * commande) à partir de la chaîne BL → plan → dépotages réels.
 * Un « manquant » = volume prévu − volume réellement dépoté. Une ligne est « en
 * retard » si elle reste non soldée au-delà de DELAI_MANQUANT_JOURS après chargement.
 */
// Mémoïsé 60 s : déduplique les scans répétés et les requêtes concurrentes.
export function computeManquants(filter: ManquantsFilter) {
  const key = `manquants:${filter.bonCommandeId ?? '*'}:${filter.mois ?? '*'}:${filter.annee ?? '*'}:${filter.region ?? '*'}`;
  return memo(key, 60_000, () => computeManquantsImpl(filter));
}

async function computeManquantsImpl(filter: ManquantsFilter) {
  const seuilJours = getNum('manquant.delaiJours', env.DELAI_MANQUANT_JOURS);
  const minLitres = getNum('manquant.minLitres', env.MANQUANT_MIN_LITRES);        // plancher anti-bruit
  const critLitres = getNum('manquant.critiqueLitres', env.MANQUANT_CRITIQUE_LITRES); // manquant site critique
  const critCamion = getNum('manquant.camionCritiqueLitres', env.MANQUANT_CAMION_CRITIQUE_LITRES);
  const now = Date.now();

  // Les brouillons (non finalisés) ne représentent pas un chargement réel → exclus.
  const where: Prisma.BonLivraisonWhereInput = { statut: { not: 'ANNULE' }, isBrouillon: false };
  if (filter.bonCommandeId) where.bonCommandeId = filter.bonCommandeId;
  if (filter.mois) where.mois = filter.mois;
  if (filter.annee) where.annee = filter.annee;
  if (!filter.bonCommandeId && !filter.annee) where.annee = new Date().getFullYear();

  const bls = await prisma.bonLivraison.findMany({
    where,
    include: {
      bonCommande: { select: { id: true, numero: true, annee: true, trimestre: true } },
      transporteur: { select: { nom: true } },
      lignes: {
        include: {
          site: { select: { id: true, code: true, nom: true, region: true } },
          depotages: { select: { volumeLitres: true } },
        },
      },
    },
  });

  const bcIds = [...new Set(bls.map((b) => b.bonCommandeId))];
  const volumes = bcIds.length
    ? await prisma.volumeMensuel.findMany({ where: { bonCommandeId: { in: bcIds } } })
    : [];
  const volMensuel = new Map<string, number>(); // `${bcId}|${mois}` → prévu
  const volBc = new Map<string, number>();       // bcId → Σ prévu
  for (const v of volumes) {
    volMensuel.set(`${v.bonCommandeId}|${v.mois}`, n(v.volumePrevuLitres));
    volBc.set(v.bonCommandeId, (volBc.get(v.bonCommandeId) ?? 0) + n(v.volumePrevuLitres));
  }

  type SiteAgg = { siteId: string; siteCode: string; siteNom: string; region: string; prevu: number; livre: number; manquant: number; nbLignes: number; nbEnRetard: number; nbCritiques: number };
  const parSiteMap = new Map<string, SiteAgg>();
  const parCamion: Array<Record<string, unknown>> = [];
  const lignesEnRetard: LigneEnRetard[] = [];
  const camionsCritiques: CamionCritique[] = [];

  type MoisAgg = { bcId: string; bcNumero: string; annee: number; mois: number; prevu: number; charge: number; livre: number };
  const parMoisMap = new Map<string, MoisAgg>();
  type BcAgg = { bcId: string; numero: string; annee: number; trimestre: number; prevu: number; charge: number; livre: number };
  const parBcMap = new Map<string, BcAgg>();

  for (const bl of bls) {
    const jours = Math.floor((now - bl.dateChargement.getTime()) / 86_400_000);
    const enRetardDelai = jours > seuilJours;
    let blDistribue = 0;
    let blSitesManquants = 0;

    for (const l of bl.lignes) {
      const prevu = n(l.volumePrevuLitres);
      const livre = l.depotages.reduce((s, d) => s + n(d.volumeLitres), 0);
      const manquant = Math.max(0, prevu - livre);
      blDistribue += livre;
      const critique = manquant >= critLitres;
      // Alerte si manquant ≥ plancher ET (délai dépassé OU critique → immédiat).
      const enRetard = manquant >= minLitres && (enRetardDelai || critique);
      if (manquant > EPS) blSitesManquants++;

      // Le niveau site honore le filtre régional (camion/mois/BC restent nationaux).
      const dansRegion = !filter.region || l.site.region === filter.region;
      if (dansRegion) {
        const ps = parSiteMap.get(l.site.id) ?? { siteId: l.site.id, siteCode: l.site.code, siteNom: l.site.nom, region: l.site.region, prevu: 0, livre: 0, manquant: 0, nbLignes: 0, nbEnRetard: 0, nbCritiques: 0 };
        ps.prevu += prevu; ps.livre += livre; ps.manquant += manquant; ps.nbLignes++; if (enRetard) ps.nbEnRetard++; if (critique) ps.nbCritiques++;
        parSiteMap.set(l.site.id, ps);
      }

      if (enRetard && dansRegion) {
        lignesEnRetard.push({
          siteCode: l.site.code, siteNom: l.site.nom, region: l.site.region,
          numeroBL: bl.numeroBL, bcNumero: bl.bonCommande.numero,
          dateChargement: bl.dateChargement, jours, prevu, livre, manquant, critique,
        });
      }
    }

    const charge = n(bl.volumeChargeLitres);
    // Niveau camion : écart chargé − distribué supérieur au seuil critique (signal perte/vol).
    const ecartCamion = Math.max(0, charge - blDistribue);
    if (ecartCamion >= critCamion) {
      camionsCritiques.push({
        numeroBL: bl.numeroBL, bcNumero: bl.bonCommande.numero,
        immatriculation: bl.immatriculation, transporteur: bl.transporteur?.nom ?? null,
        charge: Math.round(charge), distribue: Math.round(blDistribue), manquant: Math.round(ecartCamion), jours,
      });
    }
    parCamion.push({
      blId: bl.id, numeroBL: bl.numeroBL, bcNumero: bl.bonCommande.numero,
      mois: bl.mois, annee: bl.annee, immatriculation: bl.immatriculation,
      transporteur: bl.transporteur?.nom ?? null,
      dateChargement: bl.dateChargement, jours,
      charge, distribue: blDistribue, manquant: Math.max(0, charge - blDistribue),
      nbSites: bl.lignes.length, nbSitesManquants: blSitesManquants,
      enRetard: enRetardDelai && charge - blDistribue > EPS,
      critique: ecartCamion >= critCamion,
    });

    // Agrégat mensuel (par bon de commande + mois).
    const mKey = `${bl.bonCommandeId}|${bl.mois}`;
    const ma = parMoisMap.get(mKey) ?? { bcId: bl.bonCommandeId, bcNumero: bl.bonCommande.numero, annee: bl.annee, mois: bl.mois, prevu: volMensuel.get(mKey) ?? 0, charge: 0, livre: 0 };
    ma.charge += charge; ma.livre += blDistribue;
    parMoisMap.set(mKey, ma);

    // Agrégat par bon de commande.
    const ba = parBcMap.get(bl.bonCommandeId) ?? { bcId: bl.bonCommandeId, numero: bl.bonCommande.numero, annee: bl.bonCommande.annee, trimestre: bl.bonCommande.trimestre, prevu: volBc.get(bl.bonCommandeId) ?? 0, charge: 0, livre: 0 };
    ba.charge += charge; ba.livre += blDistribue;
    parBcMap.set(bl.bonCommandeId, ba);
  }

  const round = (x: number) => Math.round(x);

  const parSite = [...parSiteMap.values()]
    .filter((s) => s.manquant > EPS)
    .map((s) => ({ ...s, prevu: round(s.prevu), livre: round(s.livre), manquant: round(s.manquant) }))
    .sort((a, b) => b.manquant - a.manquant);

  const camions = parCamion
    .filter((c) => (c.manquant as number) > EPS)
    .map((c) => ({ ...c, charge: round(c.charge as number), distribue: round(c.distribue as number), manquant: round(c.manquant as number) }))
    .sort((a, b) => (b.manquant as number) - (a.manquant as number));

  const parMois = [...parMoisMap.values()]
    .map((m) => ({ ...m, prevu: round(m.prevu), charge: round(m.charge), livre: round(m.livre), manquantCharge: round(Math.max(0, m.prevu - m.charge)), manquantLivre: round(Math.max(0, m.prevu - m.livre)) }))
    .sort((a, b) => a.annee - b.annee || a.mois - b.mois);

  const parBc = [...parBcMap.values()]
    .map((b) => ({ ...b, prevu: round(b.prevu), charge: round(b.charge), livre: round(b.livre), manquant: round(Math.max(0, b.prevu - b.livre)) }))
    .sort((a, b) => b.manquant - a.manquant);

  const totaux = {
    manquantSitesLitres: round(parSite.reduce((s, x) => s + x.manquant, 0)),
    nbSitesManquants: parSite.length,
    nbSitesEnRetard: parSite.filter((s) => s.nbEnRetard > 0).length,
    nbCamionsEcart: camions.length,
    manquantMensuelLitres: round(parMois.reduce((s, x) => s + x.manquantLivre, 0)),
    nbLignesEnRetard: lignesEnRetard.length,
    nbLignesCritiques: lignesEnRetard.filter((l) => l.critique).length,
    nbCamionsCritiques: camionsCritiques.length,
  };

  return { seuilJours, parSite, parCamion: camions, parMois, parBc, totaux, lignesEnRetard, camionsCritiques };
}
