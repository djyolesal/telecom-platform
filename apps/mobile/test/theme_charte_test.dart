import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:telecom_mobile/core/theme/app_theme.dart';

/// La charte choisie au portail (Administration → Apparence) descend jusqu'au
/// terrain via /config. Ces tests verrouillent ce qui doit et ne doit PAS
/// changer — et le refus d'une valeur mal formée, qui rendrait l'app illisible.
void main() {
  late Color brandInitial;

  setUp(() {
    brandInitial = AppColors.brand;
  });

  tearDown(() {
    AppColors.appliquerTheme({'brand': '#1B3F6B', 'brandLight': '#2471A3', 'accent': '#0E7C6B'});
  });

  test('une charte reçue du serveur repeint les couleurs de marque', () {
    AppColors.appliquerTheme({'brand': '#002855', 'brandLight': '#F27D0F', 'accent': '#006AA6'});
    expect(AppColors.brand, const Color(0xFF002855));
    expect(AppColors.brandLight, const Color(0xFFF27D0F));
    expect(AppColors.accent, const Color(0xFF006AA6));
  });

  test('les couleurs de STATUT ne changent jamais', () {
    AppColors.appliquerTheme({'brand': '#002855', 'brandLight': '#F27D0F'});
    // Un incident critique reste rouge quelle que soit la charte : en plein
    // soleil, c'est la couleur qui porte l'information.
    expect(AppColors.critique, const Color(0xFFC0392B));
    expect(AppColors.majeur, const Color(0xFFE67E22));
  });

  test('une valeur mal formée est ignorée, l\'ancienne charte reste', () {
    AppColors.appliquerTheme({'brand': 'bleu foncé'});
    expect(AppColors.brand, brandInitial);
    AppColors.appliquerTheme({'brand': '#GGGGGG'});
    expect(AppColors.brand, brandInitial);
  });

  test('un thème absent ne casse rien', () {
    AppColors.appliquerTheme(null);
    expect(AppColors.brand, brandInitial);
  });

  test('le thème se construit avec la charte reçue', () {
    AppColors.appliquerTheme({'brand': '#002855'});
    expect(AppTheme.light.appBarTheme.backgroundColor, const Color(0xFF002855));
  });
}
