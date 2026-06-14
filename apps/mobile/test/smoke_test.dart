import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

// Importer le sommet de l'app force la compilation de tout l'arbre
// (router → écrans → repositories → core → base Drift générée).
import 'package:telecom_mobile/app.dart';
import 'package:telecom_mobile/main.dart' as app_main;
import 'package:telecom_mobile/injection.dart';
import 'package:telecom_mobile/core/widgets/common_widgets.dart';
import 'package:telecom_mobile/features/auth/domain/user.dart';

void main() {
  test('User : sérialisation JSON aller-retour', () {
    const u = User(id: '1', nom: 'Doe', prenom: 'Jane', email: 'jane@telecom.tg', role: 'TECHNICIEN');
    final back = User.decode(u.encode());
    expect(back.email, 'jane@telecom.tg');
    expect(back.fullName, 'Jane Doe');
    expect(back.initials, 'JD');
  });

  testWidgets('StatusChip se rend correctement', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: Scaffold(body: StatusChip(label: 'OK', color: Colors.green))),
    );
    expect(find.text('OK'), findsOneWidget);
  });

  testWidgets('EmptyView affiche le titre', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: Scaffold(body: EmptyView(title: 'Aucune donnée'))),
    );
    expect(find.text('Aucune donnée'), findsOneWidget);
  });

  test('Références de compilation (app, main, injection)', () {
    expect(TelecomApp, isNotNull);
    expect(app_main.main, isNotNull);
    expect(Injection, isNotNull);
  });
}
