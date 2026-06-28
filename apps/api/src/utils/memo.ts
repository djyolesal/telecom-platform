/**
 * Mémoïsation à durée de vie courte (TTL) pour des calculs coûteux et lus
 * fréquemment (agrégats carburant). Stocke la PROMESSE → déduplique aussi les
 * appels concurrents (ex. deux requêtes du même chargement de page). En cas
 * d'échec, l'entrée est purgée pour permettre une nouvelle tentative.
 */
const store = new Map<string, { exp: number; val: unknown }>();
const MAX_ENTRIES = 500; // borne anti-fuite mémoire

/** Purge les entrées périmées ; si le cache reste trop gros, évince les plus anciennes. */
function evict(now: number): void {
  for (const [k, v] of store) if (v.exp <= now) store.delete(k);
  if (store.size > MAX_ENTRIES) {
    const surplus = store.size - MAX_ENTRIES;
    let i = 0;
    for (const k of store.keys()) { if (i++ >= surplus) break; store.delete(k); } // FIFO (Map garde l'ordre d'insertion)
  }
}

export function memo<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit) {
    if (hit.exp > now) return Promise.resolve(hit.val as Promise<T>);
    store.delete(key); // entrée périmée → purge paresseuse
  }
  evict(now);
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
