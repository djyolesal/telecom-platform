import { Request } from 'express';

/**
 * Numéro de build de l'APK qui parle, tiré de `X-App-Version` (« 1.8.0+48 »).
 *
 * `null` quand l'en-tête est absent ou illisible : les APK anciens (b40, b43)
 * ne le déclarent pas, et leur silence ne doit jamais se lire comme une
 * version élevée.
 */
export function buildApp(req: Request): number | null {
  const brut = req.headers['x-app-version'];
  const version = String(Array.isArray(brut) ? brut[0] : brut ?? '');
  const build = Number(version.split('+')[1]);
  return Number.isFinite(build) ? build : null;
}

/** L'APK qui parle est-il au moins ce build ? Un APK muet répond non. */
export function appAuMoins(req: Request, build: number): boolean {
  const vu = buildApp(req);
  return vu !== null && vu >= build;
}

/**
 * Premier build qui envoie un identifiant d'appareil PROPRE À UN TÉLÉPHONE.
 *
 * Jusqu'à b47, l'app envoyait `Build.ID` d'Android - le numéro du firmware,
 * identique sur tous les exemplaires d'un même modèle. Le verrou d'appareil
 * liait donc un modèle : cinq « appareils » regroupaient trente-deux comptes,
 * et le verrou bilatéral (un appareil, un compte) aurait refusé la connexion à
 * une trentaine de techniciens qui n'ont jamais partagé quoi que ce soit.
 *
 * En dessous de ce build, le verrou est donc DÉSARMÉ : ce que l'app envoie ne
 * désigne aucun téléphone, on ne lie rien et on ne refuse personne.
 */
export const BUILD_APPAREIL_UNIQUE = 48;
