import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import { prisma } from '../config/database';
import { getNum, getRaw, typesLiaison } from '../services/settings.service';

/**
 * Paramètres terrain exposés aux applications (mobile/web) pour garder les
 * pré-contrôles côté client alignés sur les règles autoritaires du serveur.
 */
export async function getAppConfig(_req: Request, res: Response, next: NextFunction) {
  try {
  res.json({
    success: true,
    data: {
      minDureeClotureMin: getNum('maintenance.minDureeClotureMin', env.MIN_DUREE_CLOTURE_MIN),
      geofenceRadiusM: getNum('maintenance.geofenceRadiusM', env.GEOFENCE_RADIUS_M),
      minPhotosPreventive: 6,
      minPhotosMouvement: getNum('maintenance.minPhotosMouvement', 2),
      minPhotosCurative: getNum('maintenance.minPhotosCurative', 2),
      intervalleVidangeHeures: getNum('ge.intervalleVidangeHeures', 250),
      // Référentiel des types de liaison de transmission (badges topologie, fiche site).
      typesLiaison: typesLiaison(),
      // Référentiel des types d'incident (éditable en admin) : le mobile le
      // met en cache hors-ligne avec le reste de la config — les évolutions ne
      // demandent pas de nouvelle version d'application.
      typesIncident: await prisma.typeIncidentRef.findMany({
        where: { actif: true },
        select: { code: true, libelle: true },
        orderBy: [{ systeme: 'desc' }, { libelle: 'asc' }],
      }),
      // Référentiel des équipements de dépannage (même mécanique : le mobile
      // le met en cache avec sa config, aucune mise à jour d'app requise).
      equipements: await prisma.equipementRef.findMany({
        where: { actif: true },
        select: { code: true, libelle: true, categorie: true },
        orderBy: { libelle: 'asc' },
      }),
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
      // Colonnes MASQUÉES par l'admin (liste noire) — remplace la liste
      // blanche ci-dessus : une liste blanche figée excluait silencieusement
      // toute colonne ajoutée au catalogue APRÈS l'enregistrement. Tableau
      // présent (même vide) = nouveau mode ; absent = repli sur l'ancienne.
      colonnesMasquees: (() => {
        const arr = (k: string) => { const v = getRaw(k); return Array.isArray(v) ? (v as string[]) : null; };
        return {
          sites: arr('web.colonnesMasquees.sites'),
          maintenances: arr('web.colonnesMasquees.maintenances'),
          depotages: arr('web.colonnesMasquees.depotages'),
        };
      })(),
    },
  });
  } catch (err) { next(err); }
}
