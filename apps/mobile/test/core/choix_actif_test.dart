import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:telecom_mobile/core/theme/app_theme.dart';
import 'package:telecom_mobile/features/maintenance/data/maintenance_model.dart';
import 'package:telecom_mobile/features/maintenance/presentation/choix_actif.dart';

ActifLite actif(String id, String libelle, String? nom, [String? code]) => ActifLite(
    id: id, actifType: 'GE', categorie: 'GE', libelle: libelle,
    siteId: nom == null ? null : 's$id', siteNom: nom, siteCode: code);

void main() {
  final parc = [
    actif('1', 'GE 100 kVA', 'Sokodé 1', 'CEN-001'),
    actif('2', 'GE 100 kVA', 'Lomé Port', 'MAR-010'),
    actif('3', 'Climatiseur 12000 BTU', 'Sokodé 2', 'CEN-002'),
    actif('4', 'Batterie 48V', null),
  ];
  List<String> ids(String q) => rechercherActifs(q, parc).map((a) => a.id).toList();

  group('recherche', () {
    test('par nom de site, sans accent ni casse', () {
      expect(ids('sokode'), containsAll(['1', '3']));
      expect(ids('sokode'), hasLength(2));
    });
    test('par libellé', () => expect(ids('clim'), ['3']));
    test('libellé ET site se combinent', () => expect(ids('ge lome'), ['2']));
    test('par code du site', () => expect(ids('mar-010'), ['2']));
    test('le dépôt se cherche aussi', () => expect(ids('depot'), ['4']));
    test('rien ne correspond', () => expect(ids('kara'), isEmpty));
    test('sans recherche : tout le parc, trié par emplacement', () {
      expect(ids(''), ['4', '2', '1', '3']);
    });
  });

  test('un actif en service affiche son site, un actif sans site le dépôt', () {
    expect(parc[0].emplacement, 'Sokodé 1');
    expect(parc[3].emplacement, 'Dépôt');
  });

  group('champ de choix', () {
    Future<void> monter(WidgetTester t, List<ActifLite> actifs, {bool chargement = false,
        GlobalKey<FormState>? cle}) async {
      ActifLite? valeur;
      await t.pumpWidget(MaterialApp(
        theme: AppTheme.light,
        home: Scaffold(
          body: StatefulBuilder(
            builder: (_, setState) => Form(
              key: cle,
              child: ActifPicker(
                label: 'Actif en service *',
                actifs: actifs,
                valeur: valeur,
                chargement: chargement,
                onChanged: (a) => setState(() => valeur = a),
              ),
            ),
          ),
        ),
      ));
    }

    testWidgets('chercher un site puis choisir : le site reste visible', (t) async {
      await monter(t, parc);
      await t.tap(find.textContaining('Rechercher par actif'));
      await t.pumpAndSettle();
      await t.enterText(find.byType(TextField), 'lome');
      await t.pumpAndSettle();
      expect(find.text('Climatiseur 12000 BTU'), findsNothing);
      await t.tap(find.text('Lomé Port'));
      await t.pumpAndSettle();
      expect(find.text('GE 100 kVA - Lomé Port'), findsOneWidget);
    });

    testWidgets('champ requis tant qu\'aucun actif n\'est choisi', (t) async {
      final cle = GlobalKey<FormState>();
      await monter(t, parc, cle: cle);
      expect(cle.currentState!.validate(), isFalse);
      await t.pump();
      expect(find.text('Requis'), findsOneWidget);
    });

    testWidgets('le « Requis » disparaît dès qu\'un actif est choisi', (t) async {
      final cle = GlobalKey<FormState>();
      await monter(t, parc, cle: cle);
      cle.currentState!.validate();
      await t.pump();
      expect(find.text('Requis'), findsOneWidget);
      await t.tap(find.textContaining('Rechercher par actif'));
      await t.pumpAndSettle();
      await t.tap(find.text('Lomé Port'));
      await t.pumpAndSettle();
      expect(find.text('Requis'), findsNothing);
      expect(cle.currentState!.validate(), isTrue);
    });

    testWidgets('liste vide : le dit au lieu d\'ouvrir une feuille vide', (t) async {
      await monter(t, const []);
      expect(find.text('Aucun actif disponible'), findsOneWidget);
    });
  });
}
