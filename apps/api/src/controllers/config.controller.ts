import { Request, Response } from 'express';
import { env } from '../config/env';

/**
 * Paramètres terrain exposés aux applications (mobile/web) pour garder les
 * pré-contrôles côté client alignés sur les règles autoritaires du serveur.
 */
export function getAppConfig(_req: Request, res: Response) {
  res.json({
    success: true,
    data: {
      minDureeClotureMin: env.MIN_DUREE_CLOTURE_MIN,
      geofenceRadiusM: env.GEOFENCE_RADIUS_M,
      minPhotosPreventive: 6,
    },
  });
}
