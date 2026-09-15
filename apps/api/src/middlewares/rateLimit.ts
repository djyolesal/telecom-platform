import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { redisClient } from '../config/redis';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';

/** Empreinte courte et non réversible d'un secret (refresh token) pour servir de clé. */
export function empreinteJeton(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex').slice(0, 32);
}

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
  failClosed?: boolean; ipMax?: number;
  /**
   * Ne compter que les ÉCHECS (statut >= 400) ; une réponse réussie EFFACE le
   * compteur. Indispensable au login : les clients légitimes partagent souvent
   * une seule IP publique (conteneur web en SSR, NAT de l'opérateur mobile),
   * et compter leurs connexions RÉUSSIES les verrouillait mutuellement. Seuls
   * les échecs — le signal du bruteforce — alimentent désormais le compteur.
   */
  countOnlyFailures?: boolean;
  /**
   * Identité comptée à la place du couple (IP, email) — par ex. l'empreinte du
   * refresh token, pour que chaque session ait SON propre quota.
   */
  identite?: (req: Request) => string }) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase().slice(0, 80) : '';
      const sujet = opts.identite?.(req) || '';
      const key = sujet ? `rl:${opts.keyPrefix}:${sujet}` : `rl:${opts.keyPrefix}:${ip}:${email}`;
      const ipKey = `rl:${opts.keyPrefix}:ip:${ip}`;
      const tooMany = (ttl: number) => {
        res.setHeader('Retry-After', String(ttl > 0 ? ttl : opts.windowSec));
        return res.status(429).json({
          success: false,
          error: `Trop de tentatives. Réessayez dans ${ttl > 0 ? ttl : opts.windowSec} secondes.`,
        });
      };

      // ── Mode « échecs seulement » : on LIT les compteurs, on laisse passer,
      // et on n'incrémente qu'après coup selon le statut de la réponse.
      if (opts.countOnlyFailures) {
        const [brutIp, brut] = await Promise.all([
          opts.ipMax ? redisClient.get(ipKey) : Promise.resolve(null),
          redisClient.get(key),
        ]);
        if (opts.ipMax && Number(brutIp ?? 0) >= opts.ipMax) return tooMany(await redisClient.ttl(ipKey));
        if (Number(brut ?? 0) >= opts.max) return tooMany(await redisClient.ttl(key));

        res.on('finish', () => {
          void (async () => {
            try {
              // Succès → l'ardoise du compte est effacée (une faute de frappe
              // suivie d'une connexion réussie ne doit laisser aucune trace).
              if (res.statusCode < 400) return void (await redisClient.del(key));
              if (res.statusCode === 429) return; // ne pas compter nos propres refus
              const n = await redisClient.incr(key);
              if (n === 1) await redisClient.expire(key, opts.windowSec);
              if (opts.ipMax) {
                const nIp = await redisClient.incr(ipKey);
                if (nIp === 1) await redisClient.expire(ipKey, opts.windowSec);
              }
            } catch (e) {
              logger.warn('[rateLimit] compteur non mis à jour', e);
            }
          })();
        });
        return next();
      }

      // Plafond GLOBAL par IP (anti password-spraying : sinon un attaquant essaie
      // 1 mot de passe sur des milliers de comptes distincts sans jamais atteindre
      // le compteur par (IP, email)). ipMax >> max ; activé quand fourni.
      if (opts.ipMax) {
        const ipCount = await redisClient.incr(ipKey);
        if (ipCount === 1) await redisClient.expire(ipKey, opts.windowSec);
        if (ipCount > opts.ipMax) return tooMany(await redisClient.ttl(ipKey));
      }

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
