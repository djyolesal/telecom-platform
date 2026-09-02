import { Prisma } from '@prisma/client';
import { AppError } from './AppError';
import { env } from '../config/env';
import { getNum } from '../services/settings.service';

/** Rayon « sur site » (configurable côté admin). */
export const geofenceRadiusM = () => getNum('maintenance.geofenceRadiusM', env.GEOFENCE_RADIUS_M);

/** Distance en mètres entre deux points GPS (formule de haversine). */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // rayon terrestre (m)
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Vérifie que l'opération (démarrage/clôture) est réalisée SUR le site.
 * - Si le site n'a pas de coordonnées, on ne peut pas vérifier → on laisse passer.
 * - Sinon la position GPS est obligatoire et doit être à moins de geofenceRadiusM().
 */
export function assertOnSite(
  // `nom` d'abord : les messages destinés au terrain désignent les sites par
  // leur NOM, jamais par leur code (règle transverse de la plateforme).
  site: { latitude: Prisma.Decimal | null; longitude: Prisma.Decimal | null; nom?: string; code?: string },
  latitude: unknown,
  longitude: unknown,
  action: string
) {
  if (site.latitude == null || site.longitude == null) return; // site non géolocalisé
  const lat = latitude == null || latitude === '' ? null : Number(latitude);
  const lng = longitude == null || longitude === '' ? null : Number(longitude);
  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) {
    // « ne peut se faire que » : accord neutre, valable pour « le dépotage »
    // comme pour « la clôture » — pas de « effectué(e) » dans un message métier.
    throw new AppError(`Position GPS requise : ${action} ne peut se faire que sur le site.`, 422);
  }
  const dist = distanceMeters(lat, lng, Number(site.latitude), Number(site.longitude));
  if (dist > geofenceRadiusM()) {
    throw new AppError(
      // La position transmise figure dans le message : quand c'est la FICHE du
      // site qui est mal géolocalisée, ce point (relevé au pied du site, ~5 m)
      // est exactement la valeur à y recopier — le NOC corrige sans rappeler
      // le technicien ni deviner où il se trouvait.
      `Vous n'êtes pas sur le site ${site.nom ?? site.code ?? ''} (à ${Math.round(dist)} m, max ${geofenceRadiusM()} m) : ${action} ne peut se faire que sur place. Position relevée à la saisie : ${lat.toFixed(6)}, ${lng.toFixed(6)}.`,
      422
    );
  }
}
