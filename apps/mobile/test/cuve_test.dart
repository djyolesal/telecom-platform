import 'package:flutter_test/flutter_test.dart';
import 'package:telecom_mobile/core/utils/cuve.dart';

/// Miroir des tests du moteur serveur (apps/api/src/utils/cuve.test.ts) : les
/// deux implémentations doivent donner LES MÊMES litres pour la même hauteur.
void main() {
  group('cuve rectangulaire (linéaire)', () {
    const cfg = ConfigCuve(
        formeCuve: 'RECTANGULAIRE', longueurCm: 200, largeurCm: 100, hauteurCm: 100);

    test('proportionnelle et bornée', () {
      expect(cfg.litresPourHauteur(0), 0);
      expect(cfg.litresPourHauteur(50), 1000);
      expect(cfg.litresPourHauteur(100), 2000);
      expect(cfg.litresPourHauteur(150), 2000);
      expect(cfg.hauteurMaxCm, 100);
    });
  });

  group('cylindre couché (segment circulaire)', () {
    const cfg =
        ConfigCuve(formeCuve: 'CYLINDRE_COUCHE', diametreCm: 100, longueurCm: 255);

    test('vide, mi-hauteur = mi-volume, plein ≈ 2002.8 L', () {
      expect(cfg.litresPourHauteur(0), 0);
      final plein = cfg.litresPourHauteur(100)!;
      expect(plein, closeTo(2002.8, 1));
      expect(cfg.litresPourHauteur(50), closeTo(plein / 2, 1));
    });

    test('NON linéaire : quart de hauteur ≈ 19.55 % du volume', () {
      final plein = cfg.litresPourHauteur(100)!;
      final quart = cfg.litresPourHauteur(25)!;
      expect(quart / plein, closeTo(0.1955, 0.005));
    });
  });

  group('barémage (prioritaire)', () {
    const cfg = ConfigCuve(
      formeCuve: 'CYLINDRE_COUCHE', diametreCm: 100, longueurCm: 255,
      baremage: [
        PointBaremage(20, 300),
        PointBaremage(60, 1100),
        PointBaremage(100, 1900),
      ],
    );

    test('interpole, proportionnel sous le premier point, borné au-delà', () {
      expect(cfg.litresPourHauteur(40), 700);
      expect(cfg.litresPourHauteur(10), 150);
      expect(cfg.litresPourHauteur(120), 1900);
      expect(cfg.volumeMaxLitres, 1900);
    });
  });

  group('non configurée', () {
    test('null et non calculable', () {
      const vide = ConfigCuve();
      expect(vide.litresPourHauteur(50), isNull);
      expect(vide.calculable, isFalse);
      const partielle = ConfigCuve(formeCuve: 'CYLINDRE_COUCHE', diametreCm: 100);
      expect(partielle.litresPourHauteur(50), isNull);
    });
  });

  test('fromJson (charge le contexte serveur)', () {
    final cfg = ConfigCuve.fromJson({
      'formeCuve': 'RECTANGULAIRE',
      'cuveLongueurCm': '200', 'cuveLargeurCm': 100, 'cuveHauteurCm': 100.0,
      'baremage': [
        {'hauteurCm': 20, 'litres': '300'},
        {'hauteurCm': 100, 'litres': 1900},
      ],
    });
    expect(cfg.litresPourHauteur(60), 1100); // barème prioritaire, interpolé
  });

  // Parité avec les moteurs api/web (filtre hauteurCm >= 0) : un point de
  // barème à hauteur 0 cm (volume résiduel à cuve vide sur un certificat de
  // jaugeage) est VALIDE et doit être retenu. Le mobile le rejetait (> 0),
  // ce qui changeait l'interpolation ou rendait la cuve « non calculable ».
  test('fromJson conserve un point de barème à hauteur 0', () {
    final cfg = ConfigCuve.fromJson({
      'formeCuve': 'RECTANGULAIRE',
      'cuveLongueurCm': 200, 'cuveLargeurCm': 100, 'cuveHauteurCm': 100,
      'baremage': [
        {'hauteurCm': 0, 'litres': 50}, // résiduel à cuve vide
        {'hauteurCm': 100, 'litres': 1050},
      ],
    });
    expect(cfg.calculable, isTrue);
    // 2 points retenus → interpolation linéaire 50 → 1050 sur 0..100 cm.
    expect(cfg.litresPourHauteur(0), 50);
    expect(cfg.litresPourHauteur(50), 550);
  });
}
