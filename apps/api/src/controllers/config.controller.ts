import { Request, Response } from 'express';
import { env } from '../config/env';
import { getNum, getRaw } from '../services/settings.service';

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
      // Colonnes optionnelles par tableau que l'admin autorise à l'affichage
      // (null = toutes celles du catalogue web).
      colonnesOptionnelles: (() => {
        const arr = (k: string) => { const v = getRaw(k); return Array.isArray(v) ? (v as string[]) : null; };
        return {
          sites: arr('web.colonnesOptionnelles.sites'),
          maintenances: arr('web.colonnesOptionnelles.maintenances'),
          depotages: arr('web.colonnesOptionnelles.depotages'),
        };
      })(),
    },
  });
}
