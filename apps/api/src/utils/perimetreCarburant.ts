/**
 * PÉRIMÈTRE CARBURANT : quels sites entrent dans les écrans de stock et de bilan.
 *
 * Un site compte s'il a UN GROUPE ÉLECTROGÈNE ou UNE CUVE. Un site qui n'a ni
 * l'un ni l'autre n'a pas un stock inconnu, il n'a pas de stock du tout : le
 * garder gonflait les dénominateurs (« sites mesurés : 0 / 558 » quand 358
 * seulement peuvent l'être) et noyait les listes de lignes « aucun relevé ».
 *
 * Le couple décide, et pas le statut du GE seul : une cuve sans groupe reste du
 * gasoil stocké, elle ne doit pas disparaître.
 *
 * Une seule définition, écrite ici, sous ses deux formes - requête Prisma et
 * prédicat - parce que le stock courant et le bilan l'appliquaient chacun de
 * leur côté, et que l'un l'avait reçue sans l'autre.
 */

/** Sites concernés, en clause Prisma. */
export const SITES_AVEC_CARBURANT = {
  OR: [{ statutGE: { not: 'PAS_DE_GE' as const } }, { cuveVolumeLitres: { gt: 0 } }],
};

/**
 * Le complément, écrit EXPLICITEMENT et non `NOT: SITES_AVEC_CARBURANT` : en
 * logique à trois états, NOT (cuve > 0) vaut NULL quand la cuve est NULL, donc
 * la ligne est exclue et le compteur rendait zéro. Le cas NULL doit être nommé.
 */
export const SITES_SANS_CARBURANT = {
  statutGE: 'PAS_DE_GE' as const,
  OR: [{ cuveVolumeLitres: null }, { cuveVolumeLitres: 0 }],
};

/** Même complément, en prédicat, pour les sites déjà chargés en mémoire. */
export function sansCarburant(site: { statutGE: string; cuveVolumeLitres: unknown }): boolean {
  const cuve = site.cuveVolumeLitres == null ? 0 : Number(site.cuveVolumeLitres);
  return site.statutGE === 'PAS_DE_GE' && !(cuve > 0);
}
