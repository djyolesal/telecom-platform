import jpeg from 'jpeg-js';
import { logger } from './logger';

/**
 * Réduit une photo JPEG pour un document destiné à partir PAR E-MAIL.
 *
 * PDFKit embarque les octets d'origine tels quels : une photo de terrain
 * (1600 px, ~300 Ko) multipliée par trente interventions donne un rapport de
 * dix mégaoctets qu'aucune messagerie ne laisse passer. Rééchantillonnée à
 * 900 px et réencodée en qualité 55, la même photo pèse ~50 Ko et reste
 * parfaitement lisible à la taille où le PDF l'affiche (moins de 6 cm).
 *
 * Tout ce qui n'est pas du JPEG (PNG, image illisible) est renvoyé INTACT :
 * une vignette est un confort, la perdre ne doit pas coûter le rapport.
 */
export function reduireJpeg(buffer: Buffer, largeurMax = 900, qualite = 55): Buffer {
  // En-tête JPEG (SOI) : les autres formats ne passent pas par ce décodeur.
  if (buffer.length < 3 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return buffer;
  try {
    const src = jpeg.decode(buffer, { useTArray: true, formatAsRGBA: true });
    if (!src.width || !src.height) return buffer;
    const facteur = Math.max(1, Math.ceil(src.width / largeurMax));
    if (facteur === 1 && buffer.length < 120_000) return buffer; // déjà légère

    const largeur = Math.max(1, Math.floor(src.width / facteur));
    const hauteur = Math.max(1, Math.floor(src.height / facteur));
    const dest = Buffer.alloc(largeur * hauteur * 4);
    // Moyenne des pixels du bloc source : un simple prélèvement ferait scintiller
    // les textures (grillage, gravier) qu'on retrouve sur toutes ces photos.
    for (let y = 0; y < hauteur; y++) {
      for (let x = 0; x < largeur; x++) {
        let r = 0, g = 0, b = 0, n = 0;
        for (let dy = 0; dy < facteur; dy++) {
          const sy = y * facteur + dy;
          if (sy >= src.height) break;
          for (let dx = 0; dx < facteur; dx++) {
            const sx = x * facteur + dx;
            if (sx >= src.width) break;
            const i = (sy * src.width + sx) * 4;
            r += src.data[i]; g += src.data[i + 1]; b += src.data[i + 2]; n++;
          }
        }
        const o = (y * largeur + x) * 4;
        dest[o] = r / n; dest[o + 1] = g / n; dest[o + 2] = b / n; dest[o + 3] = 255;
      }
    }
    const reduite = jpeg.encode({ data: dest, width: largeur, height: hauteur }, qualite).data;
    return reduite.length < buffer.length ? Buffer.from(reduite) : buffer;
  } catch (e) {
    logger.warn('[image] photo non réduite (format inattendu) :', e);
    return buffer;
  }
}
