import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:telecom_mobile/core/theme/app_theme.dart';
import 'package:telecom_mobile/features/sites/data/site_model.dart';
import 'package:telecom_mobile/features/sites/data/site_repository.dart';
import 'package:telecom_mobile/features/sites/presentation/site_detail_screen.dart';

/// Reproduit le bug terrain « le modal ne vient pas quand on clique sur
/// Mesurer la cuve » : fiche site réelle, clic réel, la feuille DOIT
/// apparaître.
class _FakeSiteRepo implements SiteRepository {
  static const site = Site(
    id: 's1',
    code: 'MAR-001',
    nom: 'Site Test',
    region: 'Maritime',
    powerConfig: 'CEET_GE',
    statutGe: 'GE_SECOURS',
    puissanceGeKva: 100,
    cuveVolumeLitres: 2000,
    cuveDimensions: '2m x 1m',
  );

  @override
  Future<Site> getSite(String id) async => site;

  @override
  Future<SiteStock?> getStock(String id) async => null;

  @override
  Future<List<TacheSite>> getTachesPreventives(String id) async => const [];

  Map<String, dynamic>? envoye;

  @override
  Future<void> majCuve(String id, Map<String, dynamic> data) async {
    envoye = data;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      super.noSuchMethod(invocation);
}

void main() {
  testWidgets('le bouton « Mesurer la cuve » ouvre bien la feuille',
      (tester) async {
    await tester.pumpWidget(
      RepositoryProvider<SiteRepository>.value(
        value: _FakeSiteRepo(),
        child: MaterialApp(
          theme: AppTheme.light,
          home: const SiteDetailScreen(siteId: 's1'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    final bouton = find.text('Mesurer la cuve');
    expect(bouton, findsOneWidget, reason: 'le bouton doit être visible');

    await tester.ensureVisible(bouton);
    await tester.tap(bouton, warnIfMissed: true);
    await tester.pumpAndSettle();

    expect(find.text('Forme de la cuve'), findsOneWidget,
        reason: 'la feuille « Mesurer la cuve » doit s\'ouvrir au clic');
    expect(find.text('Enregistrer'), findsOneWidget);
  });

  testWidgets('la saisie des dimensions part bien au serveur', (tester) async {
    final repo = _FakeSiteRepo();
    await tester.pumpWidget(
      RepositoryProvider<SiteRepository>.value(
        value: repo,
        child: MaterialApp(
          theme: AppTheme.light,
          home: const SiteDetailScreen(siteId: 's1'),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Mesurer la cuve'));
    await tester.tap(find.text('Mesurer la cuve'));
    await tester.pumpAndSettle();

    await tester.enterText(
        find.widgetWithText(TextField, 'Diametre interne (cm)'), '100');
    await tester.enterText(
        find.widgetWithText(TextField, 'Longueur interne (cm)'), '255');
    await tester.ensureVisible(find.text('Enregistrer'));
    await tester.tap(find.text('Enregistrer'));
    await tester.pumpAndSettle();

    expect(repo.envoye, isNotNull, reason: 'majCuve doit être appelé');
    expect(repo.envoye!['formeCuve'], 'CYLINDRE_COUCHE');
    expect(repo.envoye!['cuveDiametreCm'], 100);
    expect(repo.envoye!['cuveLongueurCm'], 255);
    expect(find.textContaining('Cuve enregistree'), findsOneWidget);
  });
}
