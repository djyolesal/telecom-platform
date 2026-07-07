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
}
