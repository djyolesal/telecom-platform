/**
 * Calculs métier pour les groupes électrogènes
 * Basé sur les hypothèses du prompt v3.0
 */

export interface SiteGE {
  statutGE: string;
  puissanceGEkva: number | { toNumber(): number };
}

export interface ReleveGE {
  volumeGasoilLitres: number | null | { toNumber(): number };
}

export interface StockSite {
  stockLitres: number;
  /**
   * Le stock est-il MESURÉ ? Un site jamais relevé affichait 0 L et « Cuve
   * vide » : l'outil affirmait une cuve vide là où il ne savait rien, ce qui
   * gonflait les sites en alerte et faisait diverger le total du bilan (qui,
   * lui, écarte les sites non mesurés). 0 et « inconnu » ne sont pas la même
   * chose.
   */
  mesure: boolean;
  facteurCharge: number;
  kwActif: number;
  heuresMois: number;
  litresMois: number;
  coutMoisFCFA: number;
  autonomieJours: number | null;
  niveauAlerte: 'CRITIQUE' | 'FAIBLE' | 'OK' | 'VIDE' | 'NA';
}

// Paramètres par défaut (modifiables dans SystemSettings)
export const GE_PARAMS = {
  facteurChargePermanent: 0.75,
  facteurChargeSecours: 0.65,
  consoSpecificDieselLKwh: 0.25,
  heuresMoisPermanent: 720,
  heuresMoisSecours: 240,
  prixLitreFCFA: 850,
  seuilCritiqueLitres: 300,
  seuilFaibleLitres: 700,
  autonomieCritiqueJours: 3,
  autonomieFaibleJours: 7,
};

function toNum(val: number | null | undefined | { toNumber(): number }): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'object' && 'toNumber' in val) return val.toNumber();
  return Number(val);
}

/** Conso mensuelle théorique (litres) d'UN groupe électrogène, selon sa puissance et son statut. */
export function litresMoisGE(kva: number, statut: string, params = GE_PARAMS): number {
  if (statut === 'PAS_DE_GE' || !(kva > 0)) return 0;
  const facteur = statut === 'GE_PERMANENT' ? params.facteurChargePermanent : params.facteurChargeSecours;
  const heuresMois = statut === 'GE_PERMANENT' ? params.heuresMoisPermanent : params.heuresMoisSecours;
  return kva * facteur * heuresMois * params.consoSpecificDieselLKwh;
}

/** Débit gasoil (L) par HEURE de marche d'un GE = kVA × facteur de charge × conso spécifique. */
export function litresParHeureGE(kva: number, statut: string, params = GE_PARAMS): number {
  if (statut === 'PAS_DE_GE' || !(kva > 0)) return 0;
  const facteur = statut === 'GE_PERMANENT' ? params.facteurChargePermanent : params.facteurChargeSecours;
  return kva * facteur * params.consoSpecificDieselLKwh;
}

export function calculerStockSite(
  site: SiteGE,
  dernierReleve: ReleveGE | null,
  params = GE_PARAMS
): StockSite {
  const kva = toNum(site.puissanceGEkva);
  const mesure = dernierReleve != null;
  const stockLitres = dernierReleve ? toNum(dernierReleve.volumeGasoilLitres) : 0;

  if (site.statutGE === 'PAS_DE_GE' || kva === 0) {
    return {
      // Le NIVEAU de la cuve ne dépend pas de la puissance déclarée du groupe :
      // une cuve pleine sur un site dont la kVA est à 0 (donnée manquante)
      // s'affichait à 0 L ici, et à son vrai niveau sur le bilan. On rend la
      // mesure telle quelle ; c'est la CONSOMMATION qui reste incalculable.
      stockLitres,
      mesure,
      facteurCharge: 0,
      kwActif: 0,
      heuresMois: 0,
      litresMois: 0,
      coutMoisFCFA: 0,
      autonomieJours: null,
      niveauAlerte: 'NA',
    };
  }

  const facteurCharge = site.statutGE === 'GE_PERMANENT'
    ? params.facteurChargePermanent
    : params.facteurChargeSecours;

  const heuresMois = site.statutGE === 'GE_PERMANENT'
    ? params.heuresMoisPermanent
    : params.heuresMoisSecours;

  const kwActif = kva * facteurCharge;
  const litresMois = Math.round(kwActif * heuresMois * params.consoSpecificDieselLKwh);
  const coutMoisFCFA = Math.round(litresMois * params.prixLitreFCFA);

  const litresJour = litresMois / 30;
  const autonomieJours = litresJour > 0 ? Math.round((stockLitres / litresJour) * 10) / 10 : null;

  let niveauAlerte: StockSite['niveauAlerte'] = 'OK';
  // JAMAIS RELEVÉ ≠ VIDE : sans mesure, on ne déclare pas une cuve vide.
  if (!mesure) niveauAlerte = 'NA';
  else if (stockLitres === 0) niveauAlerte = 'VIDE';
  else if (stockLitres <= params.seuilCritiqueLitres) niveauAlerte = 'CRITIQUE';
  else if (stockLitres <= params.seuilFaibleLitres) niveauAlerte = 'FAIBLE';

  return { stockLitres, mesure, facteurCharge, kwActif, heuresMois, litresMois, coutMoisFCFA, autonomieJours, niveauAlerte };
}

/** Calcule le stock total du parc */
export function calculerStockParc(sites: Array<{ stock: StockSite }>) {
  return {
    // Total sur les sites MESURÉS seulement - même règle que le bilan conso &
    // stock, sans quoi les deux écrans ne peuvent pas s'accorder.
    totalLitres: sites.reduce((s, x) => s + (x.stock.mesure ? x.stock.stockLitres : 0), 0),
    nbSitesMesures: sites.filter((x) => x.stock.mesure).length,
    totalLitresMois: sites.reduce((s, x) => s + x.stock.litresMois, 0),
    totalCoutMoisFCFA: sites.reduce((s, x) => s + x.stock.coutMoisFCFA, 0),
    nbSitesVides: sites.filter(x => x.stock.niveauAlerte === 'VIDE').length,
    nbSitesCritiques: sites.filter(x => x.stock.niveauAlerte === 'CRITIQUE').length,
    nbSitesFaibles: sites.filter(x => x.stock.niveauAlerte === 'FAIBLE').length,
  };
}
