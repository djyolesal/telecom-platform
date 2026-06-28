import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { env } from '../config/env';

const n = (v: unknown): number => (v == null ? 0 : Number(v));
const EPS = 0.5; // tolérance litres

export interface ManquantsFilter {
  bonCommandeId?: string;
  mois?: number;
  annee?: number;
}

export interface LigneEnRetard {
  siteCode: string; siteNom: string; region: string;
  numeroBL: string; bcNumero: string;
  dateChargement: Date; jours: number;
  prevu: number; livre: number; manquant: number;
}

/**
 * Calcule les manquants de livraison à 4 niveaux (site, camion, mois, bon de
 * commande) à partir de la chaîne BL → plan → dépotages réels.
 * Un « manquant » = volume prévu − volume réellement dépoté. Une ligne est « en
 * retard » si elle reste non soldée au-delà de DELAI_MANQUANT_JOURS après chargement.
 */
export async function computeManquants(filter: ManquantsFilter) {
  const seuilJours = env.DELAI_MANQUANT_JOURS;
  const now = Date.now();

  const where: Prisma.BonLivraisonWhereInput = { statut: { not: 'ANNULE' } };
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

  type SiteAgg = { siteCode: string; siteNom: string; region: string; prevu: number; livre: number; manquant: number; nbLignes: number; nbEnRetard: number };
  const parSiteMap = new Map<string, SiteAgg>();
  const parCamion: Array<Record<string, unknown>> = [];
  const lignesEnRetard: LigneEnRetard[] = [];

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
      const enRetard = manquant > EPS && enRetardDelai;
      if (manquant > EPS) blSitesManquants++;

      const ps = parSiteMap.get(l.site.id) ?? { siteCode: l.site.code, siteNom: l.site.nom, region: l.site.region, prevu: 0, livre: 0, manquant: 0, nbLignes: 0, nbEnRetard: 0 };
      ps.prevu += prevu; ps.livre += livre; ps.manquant += manquant; ps.nbLignes++; if (enRetard) ps.nbEnRetard++;
      parSiteMap.set(l.site.id, ps);

      if (enRetard) {
        lignesEnRetard.push({
          siteCode: l.site.code, siteNom: l.site.nom, region: l.site.region,
          numeroBL: bl.numeroBL, bcNumero: bl.bonCommande.numero,
          dateChargement: bl.dateChargement, jours, prevu, livre, manquant,
        });
      }
    }

    const charge = n(bl.volumeChargeLitres);
    parCamion.push({
      blId: bl.id, numeroBL: bl.numeroBL, bcNumero: bl.bonCommande.numero,
      mois: bl.mois, annee: bl.annee, immatriculation: bl.immatriculation,
      transporteur: bl.transporteur?.nom ?? null,
      dateChargement: bl.dateChargement, jours,
      charge, distribue: blDistribue, manquant: Math.max(0, charge - blDistribue),
      nbSites: bl.lignes.length, nbSitesManquants: blSitesManquants, enRetard: enRetardDelai && charge - blDistribue > EPS,
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
  };

  return { seuilJours, parSite, parCamion: camions, parMois, parBc, totaux, lignesEnRetard };
}
