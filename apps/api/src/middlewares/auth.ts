import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { redisClient } from '../config/redis';
import { AppError } from '../utils/AppError';
import { sessionValide, Plateforme } from '../services/session.service';

export interface JWTPayload {
  sub: string;
  role: string;
  iat: number;
  exp: number;
  /** Session unique par plateforme (absents sur les jetons d'avant la migration). */
  sid?: string;
  plt?: Plateforme;
}

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; role: string };
    }
  }
}

export async function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) throw new AppError('Session requise - reconnectez-vous.', 401);

    const token = authHeader.split(' ')[1];

    // Vérifier blacklist Redis
    const blacklisted = await redisClient.get(`blacklist:${token}`);
    if (blacklisted) throw new AppError('Session fermée - reconnectez-vous.', 401);

    const payload = jwt.verify(token, env.JWT_SECRET) as JWTPayload;

    // Session unique par plateforme : un login plus récent sur la même
    // plateforme invalide immédiatement les jetons de l'ancienne session.
    // (Les jetons émis avant la migration n'ont pas de sid : tolérés jusqu'à
    // leur expiration — 12 h max.)
    if (payload.sid && payload.plt) {
      const ok = await sessionValide(payload.sub, payload.plt, payload.sid);
      if (!ok) throw new AppError('Session ouverte sur un autre appareil', 401);
    }

    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) return next(new AppError('Session expirée, reconnectez-vous.', 401));
    if (err instanceof jwt.JsonWebTokenError) return next(new AppError('Session invalide - reconnectez-vous.', 401));
    next(err);
  }
}
