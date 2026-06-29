import { GE_PARAMS } from './calculator';

/**
 * Gasoil attendu (litres) pour un GE sur une période, selon sa puissance, son
 * statut (permanent/secours) et ses heures de fonctionnement.
 * Formule : puissance(kVA) × facteur de charge × heures × conso spécifique (L/kWh).
 */
export function expectedGasoilGE(puissanceKva: number, statut: string, heures: number): number {
  if (!(puissanceKva > 0) || !(heures > 0)) return 0;
  const facteur = statut === 'GE_PERMANENT' ? GE_PARAMS.facteurChargePermanent : GE_PARAMS.facteurChargeSecours;
  return puissanceKva * facteur * heures * GE_PARAMS.consoSpecificDieselLKwh;
}

/**
 * Compare le gasoil réellement consommé (cuve) au gasoil attendu (heures × puissance)
 * et renvoie le commentaire d'analyse, ou null si non calculable (gasoil inconnu).
 * `seuilPct` = tolérance d'écart en pourcentage (ex. 25).
 */
export function analyseGasoilCoherence(opts: {
  consomme: number | null;
  attendu: number;
  hasHeures: boolean;
  seuilPct: number;
}): string | null {
  const { consomme, attendu, hasHeures, seuilPct } = opts;
  if (consomme == null) return null;
  if (!hasHeures || attendu <= 0) {
    return 'Analyse de cohérence indisponible : heures GE non calculables (relevé de référence / première visite).';
  }
  const exp = Math.round(attendu);
  const act = Math.round(consomme);
  const ecart = (consomme - attendu) / attendu;
  const pct = Math.round(ecart * 100);
  const signe = pct >= 0 ? '+' : '';
  const seuil = seuilPct / 100;
  if (Math.abs(ecart) <= seuil) {
    return `Cohérent : ${act} L consommés pour ~${exp} L attendus (écart ${signe}${pct}%) selon les heures GE et la puissance.`;
  }
  if (ecart > seuil) {
    return `⚠ Surconsommation : ${act} L consommés contre ~${exp} L attendus (${signe}${pct}%). À vérifier : fuite, vol de carburant, ou heures GE sous-déclarées.`;
  }
  return `⚠ Sous-consommation : ${act} L consommés contre ~${exp} L attendus (${pct}%). À vérifier : heures GE surévaluées, ou dépotage non enregistré.`;
}

/**
 * Compare le volume réellement entré en cuve (jauge après − avant) au volume annoncé
 * sur le bordereau/BL et renvoie le commentaire, ou null si l'annoncé est inconnu.
 * `seuilPct` = tolérance d'écart en pourcentage (ex. 5).
 */
export function analyseLivraison(opts: {
  volumeReel: number;
  volumeAnnonce: number | null;
  seuilPct: number;
}): string | null {
  const { volumeReel, volumeAnnonce, seuilPct } = opts;
  if (volumeAnnonce == null || !(volumeAnnonce > 0)) return null;
  const reel = Math.round(volumeReel);
  const ann = Math.round(volumeAnnonce);
  const ecart = (volumeReel - volumeAnnonce) / volumeAnnonce;
  const pct = Math.round(ecart * 100);
  const signe = pct >= 0 ? '+' : '';
  if (Math.abs(ecart) <= seuilPct / 100) {
    return `Livraison conforme : ${reel} L mesurés en cuve pour ${ann} L annoncés (écart ${signe}${pct}%).`;
  }
  if (ecart < 0) {
    return `⚠ Manquant livraison : ${reel} L réellement entrés en cuve contre ${ann} L annoncés (${pct}%). À vérifier : volume non livré, jauge erronée, ou siphonnage.`;
  }
  return `⚠ Surplus livraison : ${reel} L mesurés en cuve contre ${ann} L annoncés (${signe}${pct}%). À vérifier : jauge avant erronée ou stock résiduel sous-estimé.`;
}
