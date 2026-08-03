import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError';

/**
 * Middleware RBAC — vérifie que le rôle de l'utilisateur figure dans la liste autorisée
 * Usage : rbac(['MANAGER', 'ADMIN'])
 */
export function rbac(allowedRoles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new AppError('Non authentifié', 401));
    if (!allowedRoles.includes(req.user.role)) {
      return next(new AppError(`Accès refusé. Rôles requis : ${allowedRoles.join(', ')}`, 403));
    }
    next();
  };
}

/*
 * `minRole()` a été retiré : plus aucune route ne l'utilisait, et sa hiérarchie
 * ignorait les rôles NOC et TRANSPORTEUR (niveau 0 par défaut) — la ressortir
 * telle quelle aurait ouvert ou fermé des accès au hasard. Le contrôle d'accès
 * passe exclusivement par rbac([...]) avec une liste explicite.
 */
