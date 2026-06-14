import { createClient } from 'redis';
import { env } from './env';
import { logger } from '../utils/logger';

/**
 * Client Redis (node-redis v4) utilisé pour :
 *  - le cache applicatif (cacheService)
 *  - le stockage des refresh tokens et la blacklist JWT
 *  - les sessions
 * Les queues Bull ouvrent leurs propres connexions via REDIS_URL.
 */
export const redisClient = createClient({ url: env.REDIS_URL });

redisClient.on('error', (err) => logger.error('Redis error:', err));
redisClient.on('reconnecting', () => logger.warn('Redis reconnexion...'));
redisClient.on('ready', () => logger.info('Redis prêt'));
