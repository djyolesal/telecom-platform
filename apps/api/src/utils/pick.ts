/**
 * Liste blanche : ne conserve que les clés explicitement autorisées d'un corps
 * de requête (ferme le mass-assignment — statut, technicienId, isSynced,
 * dateDebut, role… ne peuvent plus être injectés depuis le client).
 * Les clés absentes du corps ne sont pas ajoutées (undefined ignoré).
 */
export function pick<T extends Record<string, unknown>>(body: unknown, keys: readonly (keyof T)[]): Partial<T> {
  const src = (body ?? {}) as Record<string, unknown>;
  const out: Partial<T> = {};
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(src, k as string) && src[k as string] !== undefined) {
      out[k] = src[k as string] as T[keyof T];
    }
  }
  return out;
}
