/**
 * Tri délégué des listes paginées (clic sur les en-têtes du tableau web).
 *
 * La pagination étant côté serveur, un tri local du navigateur ne
 * réordonnerait que la page affichée en le laissant croire global : chaque
 * liste expose donc une liste BLANCHE clé d'en-tête → orderBy Prisma, et le
 * tri demandé (`?tri=…&sens=asc|desc`) est appliqué avant pagination, avec un
 * départage stable fourni par l'appelant. Clé inconnue ou absente → null,
 * l'appelant garde son tri métier par défaut.
 */
export function triListe(
  query: Record<string, unknown>,
  tris: Record<string, (sens: 'asc' | 'desc') => Record<string, unknown>>,
  departage?: Record<string, unknown>
): Record<string, unknown>[] | null {
  const cle = String(query.tri ?? '');
  // hasOwnProperty : sans ça `?tri=constructor` atteint le prototype de l'objet.
  if (!cle || !Object.prototype.hasOwnProperty.call(tris, cle)) return null;
  const sens = query.sens === 'desc' ? ('desc' as const) : ('asc' as const);
  return departage ? [tris[cle](sens), departage] : [tris[cle](sens)];
}
