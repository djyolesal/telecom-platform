import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import { prisma } from '../config/database';
import { getNum, getRaw, typesLiaison } from '../services/settings.service';
import { themeEffectif } from './theme.controller';

/**
 * Paramètres terrain exposés aux applications (mobile/web) pour garder les
 * pré-contrôles côté client alignés sur les règles autoritaires du serveur.
 */
export async function getAppConfig(_req: Request, res: Response, next: NextFunction) {
  try {
  // Référentiels indépendants chargés EN PARALLÈLE : cette route est appelée
  // à chaque démarrage d'application sur toute la flotte.
  const [typesIncident, equipements, pieces] = await Promise.all([
    prisma.typeIncidentRef.findMany({
      where: { actif: true },
      select: { code: true, libelle: true },
      orderBy: [{ systeme: 'desc' }, { libelle: 'asc' }],
    }),
    prisma.equipementRef.findMany({
      where: { actif: true },
      select: { code: true, libelle: true, categorie: true },
      orderBy: { libelle: 'asc' },
    }),
    prisma.pieceRef.findMany({
      where: { actif: true },
      select: { code: true, libelle: true, unite: true },
      orderBy: { libelle: 'asc' },
    }),
  ]);
  res.json({
    success: true,
    data: {
      minDureeClotureMin: getNum('maintenance.minDureeClotureMin', env.MIN_DUREE_CLOTURE_MIN),
      geofenceRadiusM: getNum('maintenance.geofenceRadiusM', env.GEOFENCE_RADIUS_M),
      minPhotosPreventive: 6,
      minPhotosMouvement: getNum('maintenance.minPhotosMouvement', 2),
      minPhotosCurative: getNum('maintenance.minPhotosCurative', 2),
      // État des lieux AVANT exigé au démarrage d'un incident (photos APRES à la clôture).
      minPhotosIncidentAvant: getNum('incident.minPhotosAvant', 2),
      // Minimum à la DÉCLARATION (0 = facultatif). Servi par le serveur pour
      // qu'un changement de règle n'exige pas un nouvel APK.
      minPhotosIncidentDeclaration: getNum('incident.minPhotosDeclaration', 0),
      minPhotosMouvementCarburant: getNum('carburant.minPhotosMouvement', 2),
      // THÈME : le terrain porte la même charte que le portail. Converti en
      // hexadécimal — le web consomme des triplets RVB pour pouvoir calculer
      // des opacités en CSS, Flutter veut un entier de couleur. Seules les
      // couleurs de MARQUE sont servies : le rouge d'un incident critique ne
      // change pas avec la charte, sur mobile encore moins qu'ailleurs.
      theme: (() => {
        const t = themeEffectif();
        const hex = (triplet: string) => '#' + triplet.trim().split(/\s+/)
          .map((n) => Math.max(0, Math.min(255, parseInt(n, 10) || 0)).toString(16).padStart(2, '0'))
          .join('').toUpperCase();
        return { brand: hex(t.brand), brandLight: hex(t.brandLight), accent: hex(t.accent) };
      })(),
      intervalleVidangeHeures: getNum('ge.intervalleVidangeHeures', 250),
      // Référentiel des types de liaison de transmission (badges topologie, fiche site).
      typesLiaison: typesLiaison(),
      // Référentiel des types d'incident (éditable en admin) : le mobile le
      // met en cache hors-ligne avec le reste de la config — les évolutions ne
      // demandent pas de nouvelle version d'application.
      typesIncident,
      // Référentiel des équipements de dépannage (même mécanique : le mobile
      // le met en cache avec sa config, aucune mise à jour d'app requise).
      equipements,
      // Catalogue des pièces de rechange (même mécanique) : un APK futur
      // proposera la liste à la saisie ; les APK actuels l'ignorent sans mal.
      pieces,
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
