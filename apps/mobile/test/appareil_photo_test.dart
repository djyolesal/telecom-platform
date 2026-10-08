import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:telecom_mobile/core/theme/app_theme.dart';
import 'package:telecom_mobile/core/widgets/appareil_photo.dart';

/// Appareil photo intégré : une caméra qui ne répond pas (ici, pas de plugin
/// en test) ne doit ni planter ni laisser le technicien devant un sablier - au
/// bout du délai, l'écran propose l'appareil photo du téléphone. Pompé sous le VRAI thème (piège des boutons de largeur infinie).
void main() {
  testWidgets('sans caméra : écran de repli visible, sans erreur de layout', (tester) async {
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.light,
      home: const AppareilPhotoScreen(coteMax: 2000, qualite: 70),
    ));
    // Le sablier tourne tant que la caméra ne répond pas : on avance l'horloge
    // au-delà du délai de démarrage plutôt que d'attendre qu'il s'arrête.
    expect(find.byTooltip('Annuler'), findsOneWidget);
    await tester.pump(const Duration(seconds: 11));
    await tester.pump();

    expect(find.text('Utiliser l’appareil photo du téléphone'), findsOneWidget);
    expect(find.text('Annuler'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
