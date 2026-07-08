import { Request, Response } from 'express';
import { env } from '../config/env';
import { getNum } from '../services/settings.service';

/**
 * Paramètres terrain exposés aux applications (mobile/web) pour garder les
 * pré-contrôles côté client alignés sur les règles autoritaires du serveur.
 */
export function getAppConfig(_req: Request, res: Response) {
  res.json({
    success: true,
    data: {
      minDureeClotureMin: getNum('maintenance.minDureeClotureMin', env.MIN_DUREE_CLOTURE_MIN),
      geofenceRadiusM: getNum('maintenance.geofenceRadiusM', env.GEOFENCE_RADIUS_M),
      minPhotosPreventive: 6,
      minPhotosMouvement: getNum('maintenance.minPhotosMouvement', 2),
      intervalleVidangeHeures: getNum('ge.intervalleVidangeHeures', 250),
    },
  });
}
