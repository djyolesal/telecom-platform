import 'dart:typed_data';

/// Dimensions d'un JPEG lues dans son en-tête, sans décoder l'image.
///
/// Les segments sont sautés par leur longueur jusqu'au premier SOF : l'EXIF
/// embarque sa propre miniature, avec ses propres marqueurs, qu'un balayage
/// naïf prendrait pour l'image. Retourne null si ce n'est pas un JPEG lisible.
({int largeur, int hauteur})? dimensionsJpeg(Uint8List b) {
  if (b.length < 4 || b[0] != 0xFF || b[1] != 0xD8) return null;
  var i = 2;
  while (i + 9 < b.length) {
    if (b[i] != 0xFF) return null;
    final marqueur = b[i + 1];
    if (marqueur == 0xD8 || marqueur == 0x01 || (marqueur >= 0xD0 && marqueur <= 0xD7)) {
      i += 2;
      continue;
    }
    final longueur = (b[i + 2] << 8) | b[i + 3];
    final estSof = marqueur >= 0xC0 &&
        marqueur <= 0xCF &&
        marqueur != 0xC4 &&
        marqueur != 0xC8 &&
        marqueur != 0xCC;
    if (estSof) {
      return (hauteur: (b[i + 5] << 8) | b[i + 6], largeur: (b[i + 7] << 8) | b[i + 8]);
    }
    i += 2 + longueur;
  }
  return null;
}

/// Paramètre `minWidth`/`minHeight` (le même pour les deux) à donner à
/// flutter_image_compress pour que le GRAND côté de la photo ne dépasse pas
/// [coteMax].
///
/// La bibliothèque réduit d'un facteur max(1, min(l/minL, h/minH)) et échange
/// minL et minH quand l'EXIF dit que la photo est tournée : passer deux fois
/// la même valeur, calculée sur le PETIT côté, donne le bon facteur dans tous
/// les cas. Une photo déjà assez petite n'est jamais agrandie.
int cibleCompression(int largeur, int hauteur, int coteMax) {
  final grand = largeur > hauteur ? largeur : hauteur;
  final petit = largeur > hauteur ? hauteur : largeur;
  if (grand <= coteMax) return petit;
  return (petit * coteMax / grand).round();
}
