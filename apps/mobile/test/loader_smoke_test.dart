import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:telecom_mobile/core/widgets/em_ops_loader.dart';
import 'package:telecom_mobile/core/widgets/common_widgets.dart';
import 'package:telecom_mobile/core/widgets/gps_refine_sheet.dart';

void main() {
  testWidgets('EmOpsLoader se rend sans exception', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: Center(child: EmOpsLoader(label: 'test')))));
    for (var i = 0; i < 8; i++) {
      await tester.pump(const Duration(milliseconds: 250));
    }
    expect(find.byType(EmOpsLoader), findsOneWidget);
  });

  testWidgets('LoadingView se rend sans exception', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: LoadingView(label: 'chargement'))));
    await tester.pump(const Duration(milliseconds: 500));
    expect(find.byType(LoadingView), findsOneWidget);
  });

  testWidgets('GpsRefineSheet se rend sans exception', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: GpsRefineSheet())));
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('Affinage de la position…'), findsOneWidget);
  });

  testWidgets('refineGpsPosition ouvre une feuille VISIBLE (chemin réel)', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: Builder(
          builder: (ctx) => Center(
            child: ElevatedButton(
              onPressed: () => refineGpsPosition(ctx),
              child: const Text('go'),
            ),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('go'));
    await tester.pump(); // pousse la route modale
    await tester.pump(const Duration(milliseconds: 300)); // animation d'entrée
    expect(find.text('Affinage de la position…'), findsOneWidget);
    // La feuille doit occuper une hauteur réelle, visible dans le viewport.
    final sheetRect = tester.getRect(find.byType(GpsRefineSheet));
    expect(sheetRect.height, greaterThan(100));
    expect(sheetRect.bottom, lessThanOrEqualTo(tester.view.physicalSize.height));
  });
}
