import { getObjectBuffer, putObjectBrut } from './storage.service';
import { reduireJpeg } from '../utils/image';
import { logger } from '../utils/logger';

/** Préfixe du cache. La clé dérive de l'original : `vignettes/photos/…/x.jpg`. */
export const PREFIXE_VIGNETTE = 'vignettes/';

export const cleVignette = (cleOriginale: string): string => `${PREFIXE_VIGNETTE}${cleOriginale}`;

/**
 * Photo allégée pour un document qui part par e-mail, avec CACHE.
 *
 * Le rééchantillonnage est en JavaScript pur (décodage + réencodage JPEG) :
 * ~90 ms par photo. Sur un lot de quarante sites à huit photos, c'est une demi
 * minute de calcul à chaque édition - le portail abandonnait avant la fin
 * (« Le serveur met trop de temps à répondre »).
 *
 * La version réduite est donc écrite à côté de l'originale, sous `vignettes/`,
 * et réutilisée aux éditions suivantes : le deuxième rapport du même mois ne
 * coûte plus que des téléchargements. Le cache est régénérable - un échec
 * d'écriture n'empêche jamais l'édition.
 */
export async function photoAllegee(cleOriginale: string, largeur = 520, qualite = 50): Promise<Buffer | null> {
  const cle = cleVignette(cleOriginale);
  try {
    return await getObjectBuffer(cle);
  } catch { /* pas encore en cache */ }

  let original: Buffer;
  try {
    original = await getObjectBuffer(cleOriginale);
  } catch {
    return null;   // photo introuvable : le document s'édite sans elle
  }
  const reduite = reduireJpeg(original, largeur, qualite);
  // Écriture du cache en arrière-plan : le rapport n'attend pas après elle.
  putObjectBrut(cle, reduite).catch((e) => logger.warn('[vignettes] cache non écrit :', e));
  return reduite;
}
