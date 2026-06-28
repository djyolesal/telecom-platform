import '../../../core/network/dio_client.dart';
import '../../../core/network/network_info.dart';
import '../../../core/sync/sync_service.dart';
import 'depotage_model.dart';

class DepotageRepository {
  final DioClient _client;
  final NetworkInfo _network;
  final SyncService _sync;

  DepotageRepository(this._client, this._network, this._sync);

  Future<List<Depotage>> getDepotages() async {
    if (!await _network.isConnected) return [];
    return _client.request(
      (dio) => dio.get('/depotages', queryParameters: {'limit': 50}),
      (data) => (data['data'] as List).map((e) => Depotage.fromJson(e as Map<String, dynamic>)).toList(),
    );
  }

  /// Lignes de plan de livraison ouvertes (prévues/partielles) pour un site.
  Future<List<PlanLigne>> getLignesLivraison(String siteId) async {
    if (!await _network.isConnected) return [];
    return _client.request(
      (dio) => dio.get('/sites/$siteId/lignes-livraison'),
      (data) => (data['data'] as List).map((e) => PlanLigne.fromJson(e as Map<String, dynamic>)).toList(),
    );
  }

  Future<SubmitResult> create({
    required String siteId,
    required double volumeLitres,
    double? stockAvantLitres,
    String? fournisseur,
    String? numeroBonLivraison,
    double? prixLitre,
    String? observations,
    double? latitude,
    double? longitude,
    String? ligneLivraisonId,
    // Validation tripartite : noms + chemins LOCAUX des signatures (uploadées par la sync).
    String? nomChauffeur,
    String? signatureChauffeurLocalPath,
    String? nomAgentSecurite,
    String? signatureAgentSecuriteLocalPath,
    String? signatureTechnicienLocalPath,
  }) {
    final attachments = <Map<String, String>>[
      if (signatureChauffeurLocalPath != null) {'path': signatureChauffeurLocalPath, 'kind': 'signature', 'field': 'signatureChauffeurPath'},
      if (signatureAgentSecuriteLocalPath != null) {'path': signatureAgentSecuriteLocalPath, 'kind': 'signature', 'field': 'signatureAgentSecuritePath'},
      if (signatureTechnicienLocalPath != null) {'path': signatureTechnicienLocalPath, 'kind': 'signature', 'field': 'signatureTechnicienPath'},
    ];
    return _sync.submit(
      endpoint: '/depotages',
      entityType: 'depotage',
      payload: {
        'siteId': siteId,
        'volumeLitres': volumeLitres,
        'dateDepotage': DateTime.now().toUtc().toIso8601String(),
        if (stockAvantLitres != null) 'stockAvantLitres': stockAvantLitres,
        if (fournisseur != null && fournisseur.isNotEmpty) 'fournisseur': fournisseur,
        if (numeroBonLivraison != null && numeroBonLivraison.isNotEmpty) 'numeroBonLivraison': numeroBonLivraison,
        if (prixLitre != null) 'prixLitre': prixLitre,
        if (observations != null && observations.isNotEmpty) 'observations': observations,
        if (latitude != null) 'latitude': latitude,
        if (longitude != null) 'longitude': longitude,
        if (ligneLivraisonId != null) 'ligneLivraisonId': ligneLivraisonId,
        if (nomChauffeur != null && nomChauffeur.isNotEmpty) 'nomChauffeur': nomChauffeur,
        if (nomAgentSecurite != null && nomAgentSecurite.isNotEmpty) 'nomAgentSecurite': nomAgentSecurite,
      },
      attachments: attachments,
    );
  }
}
