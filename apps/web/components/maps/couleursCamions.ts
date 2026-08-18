/**
 * Couleurs de la vue « carte des livraisons » du transporteur.
 *
 * Module SANS import Leaflet : la page de la carte doit pouvoir importer ces
 * constantes statiquement, or tout import de SitesMap.tsx tire `leaflet` - qui
 * touche `window` et casse le prérendu serveur (la carte elle-même n'est
 * chargée qu'en dynamique, ssr: false).
 */

/** Couleur d'un site desservi par PLUSIEURS camions (aucun ne peut la revendiquer). */
export const COULEUR_MULTI_CAMIONS = '#7C3AED';

/** Palette des camions - attribuée par ordre alphabétique de plaque. */
export const PALETTE_CAMIONS = ['#2471A3', '#0E7C6B', '#E67E22', '#C0392B', '#16A085', '#8E44AD', '#B7950B', '#5D6D7E'];
