/**
 * Mémoïsation à durée de vie courte (TTL) pour des calculs coûteux et lus
 * fréquemment (agrégats carburant). Stocke la PROMESSE → déduplique aussi les
 * appels concurrents (ex. deux requêtes du même chargement de page). En cas
 * d'échec, l'entrée est purgée pour permettre une nouvelle tentative.
 */
const store = new Map<string, { exp: number; val: unknown }>();

export function memo<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.exp > now) return Promise.resolve(hit.val as Promise<T>);
  const p = fn();
  store.set(key, { exp: now + ttlMs, val: p });
  Promise.resolve(p).catch(() => {
    const cur = store.get(key);
    if (cur && cur.val === p) store.delete(key);
  });
  return p;
}

/** Vide le cache (tests / invalidation manuelle). */
export function clearMemo(): void {
  store.clear();
}
