import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError';

// Hiérarchie des rôles
const ROLE_HIERARCHY: Record<string, number> = {
  TECHNICIEN: 1,
  SUPERVISEUR: 2,
  MANAGER: 3,
  DIRECTION: 3,
  ADMIN: 4,
};

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

/**
 * Middleware qui vérifie que l'utilisateur a au moins un niveau de rôle minimum
 */
export function minRole(minRoleName: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new AppError('Non authentifié', 401));
    const userLevel = ROLE_HIERARCHY[req.user.role] || 0;
    const requiredLevel = ROLE_HIERARCHY[minRoleName] || 99;
    if (userLevel < requiredLevel) {
      return next(new AppError(`Accès refusé. Niveau minimum requis : ${minRoleName}`, 403));
    }
    next();
  };
}
