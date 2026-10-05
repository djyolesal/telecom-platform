/**
 * Valeurs DÉRIVÉES d'un relevé : ce qui se calcule par différence avec le
 * relevé précédent de la même chaîne (même site, même compteur).
 *
 * Les rapports de consommation additionnent ces colonnes (`consommationKwh`,
 * `heuresFonctGE`, `gasoilConsommeLitres`), ils ne les recalculent pas. Un
 * relevé enregistré après coup, entre deux relevés existants, doit donc écrire
 * SES valeurs dérivées ET faire recalculer celles de son successeur - sans quoi
 * la période qu'ils couvrent serait comptée deux fois.
 *
 * Mêmes formules que la clôture de maintenance (maintenances.controller.ts,
 * « Relevés énergie ») : un relevé hors application doit se comporter comme
 * celui de l'application. Les tests de ce fichier fixent ce comportement.
 *
 * Toutes renvoient `null` quand une des mesures manque : une consommation
 * inconnue n'est pas une consommation nulle.
 */

type Mesure = number | null | undefined;
const connue = (v: Mesure): v is number => v != null && Number.isFinite(v);

/** kWh consommés entre deux index de compteur CEET (cumulé, jamais négatif). */
export function consoKwh(indexPrecedent: Mesure, index: Mesure): number | null {
  if (!connue(indexPrecedent) || !connue(index)) return null;
  return Math.max(0, index - indexPrecedent);
}

/** Heures de marche d'un GE entre deux index horaires. */
export function heuresMarche(indexPrecedent: Mesure, index: Mesure): number | null {
  if (!connue(indexPrecedent) || !connue(index)) return null;
  return Math.max(0, index - indexPrecedent);
}

/**
 * Gasoil consommé entre deux jauges de cuve : ce qu'il y avait, plus ce qui a
 * été livré entre les deux (dépotages), moins ce qu'il reste. Jamais négatif :
 * une jauge qui monte sans livraison connue n'est pas une consommation
 * négative, c'est une livraison non saisie - et la vraisemblance la signale.
 */
export function consoGasoil(jaugePrecedente: Mesure, livreEntreLesDeux: number, jauge: Mesure): number | null {
  if (!connue(jaugePrecedente) || !connue(jauge)) return null;
  return Math.max(0, jaugePrecedente + livreEntreLesDeux - jauge);
}
