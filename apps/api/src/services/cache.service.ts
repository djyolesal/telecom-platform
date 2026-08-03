import { redisClient } from '../config/redis';
import { logger } from '../utils/logger';

/**
 * Petit wrapper de cache JSON au-dessus de Redis.
 * Toutes les opérations sont tolérantes aux pannes : en cas d'erreur Redis,
 * on dégrade proprement (get → null, set/invalidate → no-op) plutôt que de planter.
 */
export const cacheService = {
  async get<T = unknown>(key: string): Promise<T | null> {
    try {
      const raw = await redisClient.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (err) {
      logger.warn(`cache.get(${key}) échoué:`, err);
      return null;
    }
  },

  async set(key: string, value: unknown, ttlSeconds = 300): Promise<void> {
    try {
      await redisClient.setEx(key, ttlSeconds, JSON.stringify(value));
    } catch (err) {
      logger.warn(`cache.set(${key}) échoué:`, err);
    }
  },

  async invalidate(keyOrPattern: string): Promise<void> {
    try {
      if (keyOrPattern.includes('*')) {
        // SCAN (curseur, non bloquant) plutôt que KEYS : cette invalidation part
        // à chaque écriture de site, et KEYS est O(N) BLOQUANT — sur un keyspace
        // important il gelait Redis, donc le cache ET le rate-limit de toute l'API.
        let cursor = 0;
        do {
          const lot = await redisClient.scan(cursor, { MATCH: keyOrPattern, COUNT: 200 });
          cursor = Number(lot.cursor);
          if (lot.keys.length) await redisClient.del(lot.keys);
        } while (cursor !== 0);
      } else {
        await redisClient.del(keyOrPattern);
      }
    } catch (err) {
      logger.warn(`cache.invalidate(${keyOrPattern}) échoué:`, err);
    }
  },
};
