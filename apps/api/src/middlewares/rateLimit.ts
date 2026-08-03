import { Request, Response, NextFunction } from 'express';
import { redisClient } from '../config/redis';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';

/**
 * Limiteur de débit basé sur Redis (partagé entre instances). Compte les
 * requêtes par IP (+ email si présent, pour cibler un compte au login) sur une
 * fenêtre glissante. Au-delà de `max`, répond 429 avec Retry-After.
 *
 * Fail-open : si Redis est indisponible, la limite n'est PAS appliquée plutôt
 * que de verrouiller l'authentification de toute la plateforme.
 */
export function rateLimit(opts: { windowSec: number; max: number; keyPrefix: string;
  /** Refuser (429) plutôt que laisser passer si Redis est indisponible. */
  failClosed?: boolean; ipMax?: number }) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase().slice(0, 80) : '';
      const tooMany = (ttl: number) => {
        res.setHeader('Retry-After', String(ttl > 0 ? ttl : opts.windowSec));
        return res.status(429).json({
          success: false,
          error: `Trop de tentatives. Réessayez dans ${ttl > 0 ? ttl : opts.windowSec} secondes.`,
        });
      };

      // Plafond GLOBAL par IP (anti password-spraying : sinon un attaquant essaie
      // 1 mot de passe sur des milliers de comptes distincts sans jamais atteindre
      // le compteur par (IP, email)). ipMax >> max ; activé quand fourni.
      if (opts.ipMax) {
        const ipKey = `rl:${opts.keyPrefix}:ip:${ip}`;
        const ipCount = await redisClient.incr(ipKey);
        if (ipCount === 1) await redisClient.expire(ipKey, opts.windowSec);
        if (ipCount > opts.ipMax) return tooMany(await redisClient.ttl(ipKey));
      }

      const key = `rl:${opts.keyPrefix}:${ip}:${email}`;
      const count = await redisClient.incr(key);
      if (count === 1) await redisClient.expire(key, opts.windowSec);
      if (count > opts.max) return tooMany(await redisClient.ttl(key));
      return next();
    } catch (e) {
      // Fail-OPEN par défaut (une panne Redis ne doit pas couper le terrain),
      // mais fail-CLOSED sur l'authentification : sans compteur, le bruteforce
      // redevient illimité — mieux vaut refuser temporairement la connexion.
      logger.warn('[rateLimit] Redis indisponible', e);
      if (opts.failClosed) {
        return next(new AppError('Service d\'authentification momentanément indisponible, réessayez.', 429));
      }
      return next();
    }
  };
}
