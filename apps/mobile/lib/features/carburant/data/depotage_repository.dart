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
      (data) => (data['data'] as List)
          .map((e) => Depotage.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }

  /// Lignes de plan de livraison ouvertes (prévues/partielles) pour un site.
  Future<List<PlanLigne>> getLignesLivraison(String siteId) async {
    if (!await _network.isConnected) return [];
    return _client.request(
      (dio) => dio.get('/sites/$siteId/lignes-livraison'),
      (data) => (data['data'] as List)
          .map((e) => PlanLigne.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }

  /// Détail complet d'un dépotage (réconciliation, heures GE, photos).
  Future<DepotageDetail> getById(String id) async {
    return _client.request(
      (dio) => dio.get('/depotages/$id'),
      (data) => DepotageDetail.fromJson(data['data'] as Map<String, dynamic>),
    );
  }

  /// Groupes électrogènes actifs d'un site (via le détail site), pour relever
  /// l'index d'heures de chaque GE au dépotage (réconciliation conso).
  Future<List<GroupeGE>> getGroupes(String siteId) async {
    if (!await _network.isConnected) return [];
    return _client.request(
      (dio) => dio.get('/sites/$siteId'),
      (data) {
        final list = (data['data']?['groupes'] as List?) ?? const [];
        return list
            .map((e) => GroupeGE.fromJson(e as Map<String, dynamic>))
            .toList();
      },
    );
  }

  Future<SubmitResult> create({
    required String siteId,
    required double volumeLitres,
    required bool agentPresent,
    double? stockAvantLitres,
    double? stockApresLitres,
    double? volumeAnnonceLitres,
    String? fournisseur,
    String? numeroBonLivraison,
    String? observations,
    double? latitude,
    double? longitude,
    String? ligneLivraisonId,
    // Index d'heures relevé par GE : [{groupeId, indexHeuresGE}].
    List<Map<String, dynamic>> heuresGE = const [],
    // Photos des travaux de dépotage (chemins LOCAUX, uploadées par la sync).
    List<String> photoPaths = const [],
    // Validation tripartite : noms + chemins LOCAUX des signatures (uploadées par la sync).
    String? nomChauffeur,
    String? signatureChauffeurLocalPath,
    String? nomAgentSecurite,
    String? signatureAgentSecuriteLocalPath,
    String? signatureTechnicienLocalPath,
    // Le technicien a vu les avertissements de vraisemblance et confirme sa saisie.
    bool confirmerVraisemblance = false,
  }) {
    final attachments = <Map<String, String>>[
      if (signatureChauffeurLocalPath != null)
        {
          'path': signatureChauffeurLocalPath,
          'kind': 'signature',
          'field': 'signatureChauffeurPath'
        },
      if (signatureAgentSecuriteLocalPath != null)
        {
          'path': signatureAgentSecuriteLocalPath,
          'kind': 'signature',
          'field': 'signatureAgentSecuritePath'
        },
      if (signatureTechnicienLocalPath != null)
        {
          'path': signatureTechnicienLocalPath,
          'kind': 'signature',
          'field': 'signatureTechnicienPath'
        },
      for (final p in photoPaths) {'path': p, 'kind': 'photo'},
    ];
    return _sync.submit(
      endpoint: '/depotages',
      entityType: 'depotage',
      payload: {
        'siteId': siteId,
        'volumeLitres': volumeLitres,
        'agentPresent': agentPresent,
        'dateDepotage': DateTime.now().toUtc().toIso8601String(),
        if (stockAvantLitres != null) 'stockAvantLitres': stockAvantLitres,
        if (stockApresLitres != null) 'stockApresLitres': stockApresLitres,
        if (volumeAnnonceLitres != null)
          'volumeAnnonceLitres': volumeAnnonceLitres,
        if (fournisseur != null && fournisseur.isNotEmpty)
          'fournisseur': fournisseur,
        if (numeroBonLivraison != null && numeroBonLivraison.isNotEmpty)
          'numeroBonLivraison': numeroBonLivraison,
        if (observations != null && observations.isNotEmpty)
          'observations': observations,
        if (latitude != null) 'latitude': latitude,
        if (longitude != null) 'longitude': longitude,
        if (ligneLivraisonId != null) 'ligneLivraisonId': ligneLivraisonId,
        if (heuresGE.isNotEmpty) 'heuresGE': heuresGE,
        if (nomChauffeur != null && nomChauffeur.isNotEmpty)
          'nomChauffeur': nomChauffeur,
        if (nomAgentSecurite != null && nomAgentSecurite.isNotEmpty)
          'nomAgentSecurite': nomAgentSecurite,
        if (confirmerVraisemblance) 'confirmerVraisemblance': true,
      },
      attachments: attachments,
    );
  }
}
