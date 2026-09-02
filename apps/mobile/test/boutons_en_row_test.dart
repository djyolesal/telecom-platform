import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:telecom_mobile/core/theme/app_theme.dart';

/// Piège du thème : les FilledButton reçoivent `minimumSize: Size.fromHeight(50)`
/// (largeur INFINIE). Dans une Row, un FilledButton sans taille compacte déborde
/// de l'écran et devient invisible - c'est arrivé au « Réessayer » de la revue
/// des échecs (b35). Ce test verrouille le motif utilisé par les feuilles de
/// revue : TextButton + FilledButton compact dans une Row.
void main() {
  testWidgets('FilledButton compact dans une Row : visible, sans débordement',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.light,
      home: Scaffold(
        body: Row(
          mainAxisAlignment: MainAxisAlignment.end,
          children: [
            TextButton(onPressed: () {}, child: const Text('Abandonner')),
            const SizedBox(width: 8),
            FilledButton(
              style: FilledButton.styleFrom(minimumSize: const Size(120, 44)),
              onPressed: () {},
              child: const Text('Réessayer'),
            ),
          ],
        ),
      ),
    ));
    // Un débordement de Row lève une exception de layout en test : son absence
    // + la présence du bouton à une position DANS l'écran = motif sain.
    expect(tester.takeException(), isNull);
    final pos = tester.getTopRight(find.text('Réessayer'));
    expect(pos.dx, lessThanOrEqualTo(800)); // largeur d'écran du harnais
  });
}
