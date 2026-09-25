import jpeg from 'jpeg-js';
import { reduireJpeg } from './image';

/** Photo de terrain simulée : 1600 px, comme celles que l'application envoie. */
function photo(largeur = 1600, hauteur = 1200, qualite = 70): Buffer {
  const data = Buffer.alloc(largeur * hauteur * 4);
  for (let y = 0; y < hauteur; y++) {
    for (let x = 0; x < largeur; x++) {
      const i = (y * largeur + x) * 4;
      data[i] = (x * 255) / largeur;
      data[i + 1] = (y * 255) / hauteur;
      data[i + 2] = (x ^ y) & 0xff;
      data[i + 3] = 255;
    }
  }
  return Buffer.from(jpeg.encode({ data, width: largeur, height: hauteur }, qualite).data);
}

describe('photos du rapport mensuel', () => {
  it('allège nettement une photo de terrain', () => {
    // Le rapport part en pièce jointe : c'est le poids des photos qui décide
    // s'il passe les filtres de messagerie.
    const src = photo();
    const reduite = reduireJpeg(src);
    expect(reduite.length).toBeLessThan(src.length / 2);
    const decodee = jpeg.decode(reduite, { useTArray: true });
    expect(decodee.width).toBeLessThanOrEqual(900);
    expect(decodee.width).toBeGreaterThan(400); // reste lisible à l'écran comme au tirage
  });

  it('rend intact ce qui n’est pas du JPEG', () => {
    // Une vignette est un confort : la perdre ne doit pas coûter le rapport.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    expect(reduireJpeg(png)).toBe(png);
    expect(reduireJpeg(Buffer.from('pas une image'))).toHaveLength('pas une image'.length);
  });

  it('laisse une petite photo tranquille', () => {
    const petite = photo(600, 450, 60);
    expect(reduireJpeg(petite).length).toBeLessThanOrEqual(petite.length);
  });
});
