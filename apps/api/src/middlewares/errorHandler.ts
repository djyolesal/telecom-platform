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
  // Corps de requête JSON malformé : express.json() lève une SyntaxError
  // (type entity.parse.failed). Sans ce cas, une accolade oubliée renvoyait
  // un 500 au lieu d'un 400, et exposait le détail du parseur.
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ success: false, error: 'Corps de requête JSON invalide.' });
  }

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
        error: 'Cette valeur existe déjà pour un autre enregistrement.',
      });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ success: false, error: 'Ressource introuvable' });
    }
    if (err.code === 'P2003') {
      return res.status(400).json({ success: false, error: 'Un élément lié à cette opération n\'existe plus. Rechargez la page et réessayez.' });
    }
    // P2000 = valeur trop longue (dépassement VarChar) ; P2011 = contrainte
    // NOT NULL ; P2012 = champ requis manquant. Une entrée cliente fautive doit
    // répondre 4xx, pas 500. `err.meta` ne contient que des noms de colonnes
    // (jamais de chemin source), donc on peut nommer le champ concerné.
    if (err.code === 'P2000') {
      return res.status(400).json({ success: false, error: 'Un des champs saisis dépasse la longueur autorisée.' });
    }
    if (err.code === 'P2011' || err.code === 'P2012') {
      return res.status(400).json({ success: false, error: 'Champ obligatoire manquant.' });
    }
    // Tout autre code connu : requête invalide, message neutre (le message brut
    // de Prisma embarque un extrait du fichier source — jamais renvoyé).
    logger.warn(`[Prisma ${err.code}] ${req.method} ${req.originalUrl}`);
    return res.status(400).json({ success: false, error: 'Requête invalide.' });
  }

  // Erreur de validation Prisma : type/enum/date invalide passé à un create/
  // update (ex. severite hors enum, latitude non numérique). Le message brut
  // contient le chemin ABSOLU du fichier et un extrait de code : ne JAMAIS le
  // renvoyer, même hors production. Réponse 422 neutre.
  if (err instanceof Prisma.PrismaClientValidationError) {
    logger.warn(`[Prisma validation] ${req.method} ${req.originalUrl}`);
    return res.status(422).json({ success: false, error: 'Données invalides.' });
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

  // Les erreurs Prisma restantes (Unknown/Initialization/RustPanic) embarquent
  // le chemin source dans leur message : on ne le renvoie jamais, même hors
  // production, où seules les erreurs applicatives gardent un message détaillé.
  const estPrisma =
    err instanceof Prisma.PrismaClientUnknownRequestError ||
    err instanceof Prisma.PrismaClientInitializationError ||
    err instanceof Prisma.PrismaClientRustPanicError;

  return res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' || estPrisma ? 'Erreur interne du serveur' : message,
  });
}
