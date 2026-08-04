import 'package:flutter_test/flutter_test.dart';
import 'package:telecom_mobile/features/carburant/data/depotage_model.dart';

/// Le transporteur consulte son plan de livraison sur le terrain : ces tests
/// verrouillent la lecture des réponses de l'API (formes réelles renvoyées par
/// GET /bons-livraison et GET /bons-livraison/:id).
void main() {
  test('BonLivraisonLite lit le nombre de sites depuis _count.lignes', () {
    final bl = BonLivraisonLite.fromJson({
      'id': 'bl-1', 'numeroBL': '3030729534', 'mois': 8, 'annee': 2025,
      'immatriculation': 'TG 0688 AH', 'volumeChargeLitres': '15000',
      'dateChargement': '2025-08-04T00:00:00.000Z', 'statut': 'CHARGE',
      '_count': {'lignes': 3},
    });
    expect(bl.numeroBL, '3030729534');
    expect(bl.volumeChargeLitres, 15000);
    expect(bl.nbSites, 3);
    expect(bl.statut, 'CHARGE');
  });

  test('BonLivraisonDetail agrège le plan et calcule le reste par site', () {
    final d = BonLivraisonDetail.fromJson({
      'id': 'bl-1', 'numeroBL': '3030729534', 'mois': 8, 'annee': 2025,
      'immatriculation': 'TG 0688 AH', 'volumeChargeLitres': '15000',
      'statut': 'CHARGE',
      'bonCommande': {'numero': 'PO250300014'},
      'sommeLignes': '15000',
      'lignes': [
        {
          'site': {'code': 'ABA', 'nom': 'ABASSE', 'region': 'Maritime'},
          'volumePrevuLitres': '10000', 'volumeLivreReel': '10000', 'statut': 'LIVRE',
        },
        {
          'site': {'code': 'TEL', 'nom': 'TELESSOU', 'region': 'Centrale'},
          'volumePrevuLitres': '5000', 'volumeLivreReel': '2000', 'statut': 'PARTIEL',
        },
      ],
    });
    expect(d.bcNumero, 'PO250300014');
    expect(d.lignes.length, 2);
    expect(d.totalLivre, 12000);
    // Reste à livrer du camion = chargé − déposé.
    expect(d.volumeChargeLitres - d.totalLivre, 3000);
    // Reste par site, jamais négatif (une sur-livraison ne devient pas un reste).
    expect(d.lignes[0].restant, 0);
    expect(d.lignes[1].restant, 3000);
  });

  test('un plan non encore défini ne casse pas la lecture', () {
    final d = BonLivraisonDetail.fromJson({
      'id': 'bl-2', 'numeroBL': 'BR-0001', 'mois': 8, 'annee': 2025,
      'immatriculation': 'À AFFECTER', 'volumeChargeLitres': '15000', 'statut': 'PLANIFIE',
    });
    expect(d.lignes, isEmpty);
    expect(d.totalLivre, 0);
    expect(d.bcNumero, isNull);
  });

  test('une sur-livraison ne produit pas un reste négatif', () {
    final l = LignePlanBL.fromJson({
      'site': {'code': 'X', 'nom': 'X', 'region': 'R'},
      'volumePrevuLitres': '1000', 'volumeLivreReel': '1200', 'statut': 'LIVRE',
    });
    expect(l.restant, 0);
  });
}
