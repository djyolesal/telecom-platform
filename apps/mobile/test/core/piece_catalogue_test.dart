import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:telecom_mobile/core/config/app_config.dart';
import 'package:telecom_mobile/core/config/piece_catalogue.dart';
import 'package:telecom_mobile/core/theme/app_theme.dart';
import 'package:telecom_mobile/features/maintenance/presentation/choix_piece.dart';

/// Pièces de rechange : le terrain CHOISIT dans le catalogue (recherche
/// tolérante), la saisie libre n'est que le dernier recours.
const catalogue = [
  PieceCatalogue(id: 'fg', code: 'GE_FILTRE_GASOIL', libelle: 'Filtre à gasoil', unite: 'unité', categorie: 'GE'),
  PieceCatalogue(id: 'fa', code: 'GE_FILTRE_AIR', libelle: 'Filtre à air', unite: 'unité', categorie: 'GE'),
  PieceCatalogue(id: 'hm', code: 'GE_HUILE_MOTEUR_15W40', libelle: 'Huile moteur 15W40', unite: 'litre', categorie: 'GE'),
  PieceCatalogue(id: 'b100', code: 'BATTERIE_12V_100AH', libelle: 'Batterie 12V 100 Ah', unite: 'unité', categorie: 'BATTERIE', synonymes: ['Batterie 100 Ah']),
  PieceCatalogue(id: 'cf', code: 'CLIM_FACADE', libelle: 'Remplacement de façade ou bac d\'écoulement', unite: 'unité', categorie: 'CLIMATISEUR'),
];

void main() {
  group('recherche dans le catalogue', () {
    List<String> ids(String q, {String? cat}) => rechercherPieces(q, catalogue, categoriePrioritaire: cat).map((p) => p.id).toList();

    test('variantes de saisie : accents, ordre, début de mot', () {
      expect(ids('filtre gasoil'), ['fg']);
      expect(ids('FACADE'), ['cf']);
      expect(ids('15w40'), ['hm']);
      expect(ids('batterie 100'), ['b100']);
    });

    test('les synonymes et le code comptent', () {
      expect(ids('100 ah'), ['b100']);
      expect(ids('ge_filtre'), containsAll(['fg', 'fa']));
    });

    test('pièces de l\'équipement maintenu en tête', () {
      expect(ids('', cat: 'CLIMATISEUR').first, 'cf');
      expect(ids('', cat: 'BATTERIE').first, 'b100');
    });
  });

  test('quantité inhabituelle : seuil plus haut pour les litres et mètres', () {
    expect(seuilQuantiteInhabituelle(catalogue[0]), 10);
    expect(seuilQuantiteInhabituelle(catalogue[2]), 60);
    expect(seuilQuantiteInhabituelle(null), 10);
  });

  group('sélecteur', () {
    PieceChoisie? resultat;
    Future<void> ouvrir(WidgetTester tester) async {
      AppConfig.pieces = catalogue;
      resultat = null;
      await tester.pumpWidget(MaterialApp(
        theme: AppTheme.light,
        home: Builder(builder: (ctx) => Scaffold(
          body: Center(child: TextButton(
            onPressed: () async => resultat = await choisirPiece(ctx, categorie: 'GE'),
            child: const Text('ouvrir'),
          )),
        )),
      ));
      await tester.tap(find.text('ouvrir'));
      await tester.pumpAndSettle();
    }

    testWidgets('rechercher puis choisir : la pièce part identifiée', (tester) async {
      await ouvrir(tester);
      await tester.enterText(find.byType(TextField).first, 'gasoil');
      await tester.pumpAndSettle();
      await tester.tap(find.text('Filtre à gasoil'));
      await tester.pumpAndSettle();
      expect(resultat?.piece?.id, 'fg');
      expect(resultat?.horsCatalogue, false);
    });

    testWidgets('pièce absente du catalogue : texte libre, marqué hors catalogue', (tester) async {
      await ouvrir(tester);
      await tester.tap(find.text('Pièce absente du catalogue'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).last, 'Courroie ventilateur Perkins');
      await tester.tap(find.text('Ajouter'));
      await tester.pumpAndSettle();
      expect(resultat?.horsCatalogue, true);
      expect(resultat?.libelle, 'Courroie ventilateur Perkins');
      expect(tester.takeException(), isNull);
    });
  });
}
