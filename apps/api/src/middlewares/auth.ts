import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { redisClient } from '../config/redis';
import { AppError } from '../utils/AppError';

export interface JWTPayload {
  sub: string;
  role: string;
  iat: number;
  exp: number;
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
    if (!authHeader?.startsWith('Bearer ')) throw new AppError('Token manquant', 401);

    const token = authHeader.split(' ')[1];

    // Vérifier blacklist Redis
    const blacklisted = await redisClient.get(`blacklist:${token}`);
    if (blacklisted) throw new AppError('Token révoqué', 401);

    const payload = jwt.verify(token, env.JWT_SECRET) as JWTPayload;
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) return next(new AppError('Token expiré', 401));
    if (err instanceof jwt.JsonWebTokenError) return next(new AppError('Token invalide', 401));
    next(err);
  }
}
