import { AppError } from './AppError';
import { PointBaremage } from './cuve';

export const POINTS_BAREME_MAX = 1000;

/**
 * Valide un barème saisi (couples hauteur cm → litres) : celui d'un site comme
 * celui d'un modèle de cuve. Remplacement complet, jamais partiel. Retourne
 * les points arrondis au dixième et triés ; une liste vide efface le barème.
 *
 * Un barème est MONOTONE : hauteurs strictement croissantes (un doublon est
 * une erreur de saisie), litres jamais décroissants.
 */
export function validerPointsBareme(brut: unknown): PointBaremage[] {
  if (!Array.isArray(brut) || brut.length > POINTS_BAREME_MAX) {
    throw new AppError(`Barème invalide : ${POINTS_BAREME_MAX} points maximum.`, 400);
  }
  const points = brut.map((p, i) => {
    const hauteurCm = Number((p as { hauteurCm?: unknown })?.hauteurCm);
    const litres = Number((p as { litres?: unknown })?.litres);
    if (!Number.isFinite(hauteurCm) || hauteurCm < 0 || !Number.isFinite(litres) || litres < 0) {
      throw new AppError(`Point n°${i + 1} invalide : la hauteur (cm) et le volume (litres) doivent être des nombres positifs.`, 400);
    }
    return { hauteurCm: Math.round(hauteurCm * 10) / 10, litres: Math.round(litres * 10) / 10 };
  }).sort((a, b) => a.hauteurCm - b.hauteurCm);
  for (let i = 1; i < points.length; i++) {
    if (points[i].hauteurCm === points[i - 1].hauteurCm) {
      throw new AppError(`Deux points à la même hauteur (${points[i].hauteurCm} cm)`, 400);
    }
    if (points[i].litres < points[i - 1].litres) {
      throw new AppError(`Litres décroissants à ${points[i].hauteurCm} cm : un barème est monotone`, 400);
    }
  }
  if (points.length === 1) throw new AppError('Un barème utilisable compte au moins 2 points (ou 0 pour l’effacer)', 400);
  return points;
}
