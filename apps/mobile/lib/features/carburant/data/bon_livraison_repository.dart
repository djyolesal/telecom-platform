import '../../../core/network/dio_client.dart';
import '../../../core/network/network_info.dart';
import '../../../core/sync/sync_service.dart';
import 'depotage_model.dart';

/// Saisie des bons de livraison par le transporteur (offline-first).
class BonLivraisonRepository {
  final DioClient _client;
  final NetworkInfo _network;
  final SyncService _sync;

  BonLivraisonRepository(this._client, this._network, this._sync);

  /// Bons de commande disponibles pour rattacher un nouveau bon de livraison.
  Future<List<BonCommandeLite>> getBonsCommande() async {
    if (!await _network.isConnected) return [];
    return _client.request(
      (dio) => dio.get('/bons-commande', queryParameters: {'limit': 50}),
      (data) => (data['data'] as List).map((e) => BonCommandeLite.fromJson(e as Map<String, dynamic>)).toList(),
    );
  }

  /// Crée un bon de livraison. Les photos des documents (BL, bordereau) sont des
  /// chemins LOCAUX uploadés par la sync, dont la clé alimente blPdfPath / bordereauPdfPath.
  Future<SubmitResult> create({
    required String bonCommandeId,
    required String numeroBL,
    required int mois,
    required int annee,
    required String immatriculation,
    required double volumeChargeLitres,
    DateTime? dateChargement,
    String? observations,
    String? blDocLocalPath,
    String? bordereauDocLocalPath,
  }) {
    final attachments = <Map<String, String>>[
      if (blDocLocalPath != null) {'path': blDocLocalPath, 'kind': 'photo', 'field': 'blPdfPath', 'folder': 'documents'},
      if (bordereauDocLocalPath != null) {'path': bordereauDocLocalPath, 'kind': 'photo', 'field': 'bordereauPdfPath', 'folder': 'documents'},
    ];
    return _sync.submit(
      endpoint: '/bons-livraison',
      entityType: 'bon_livraison',
      payload: {
        'bonCommandeId': bonCommandeId,
        'numeroBL': numeroBL,
        'mois': mois,
        'annee': annee,
        'immatriculation': immatriculation,
        'volumeChargeLitres': volumeChargeLitres,
        'dateChargement': (dateChargement ?? DateTime.now()).toUtc().toIso8601String(),
        if (observations != null && observations.isNotEmpty) 'observations': observations,
      },
      attachments: attachments,
    );
  }
}
