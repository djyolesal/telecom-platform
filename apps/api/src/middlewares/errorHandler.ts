import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';

/**
 * Gestionnaire d'erreurs central. Doit être monté en dernier (app.use(errorHandler)).
 * Normalise toutes les erreurs en réponse JSON cohérente.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  // Erreurs de validation Zod
  if (err instanceof ZodError) {
    return res.status(422).json({
      success: false,
      error: 'Validation échouée',
      details: err.flatten().fieldErrors,
    });
  }

  // Erreurs Prisma connues
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return res.status(409).json({
        success: false,
        error: `Conflit : valeur déjà existante (${(err.meta?.target as string[])?.join(', ') ?? 'champ unique'})`,
      });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ success: false, error: 'Ressource introuvable' });
    }
    if (err.code === 'P2003') {
      return res.status(400).json({ success: false, error: 'Référence invalide (clé étrangère)' });
    }
  }

  // Erreurs applicatives typées
  if (err instanceof AppError) {
    if (err.statusCode >= 500) logger.error(`[${err.statusCode}] ${err.message}`, err);
    return res.status(err.statusCode).json({
      success: false,
      error: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  // Erreur inattendue
  const message = err instanceof Error ? err.message : String(err);
  logger.error(`[500] ${req.method} ${req.originalUrl} - ${message}`, err);

  return res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' ? 'Erreur interne du serveur' : message,
  });
}
