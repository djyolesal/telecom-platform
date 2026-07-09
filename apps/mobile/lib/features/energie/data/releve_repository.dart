import '../../../core/network/dio_client.dart';
import '../../../core/network/network_info.dart';
import '../../../core/sync/sync_service.dart';
import 'releve_model.dart';

class ReleveRepository {
  final DioClient _client;
  final NetworkInfo _network;
  final SyncService _sync;

  ReleveRepository(this._client, this._network, this._sync);

  Future<List<Releve>> getReleves({String? siteId}) async {
    if (!await _network.isConnected) return [];
    return _client.request(
      (dio) => dio.get('/releves', queryParameters: {
        'limit': 50,
        if (siteId != null) 'site_id': siteId,
      }),
      (data) => (data['data'] as List).map((e) => Releve.fromJson(e as Map<String, dynamic>)).toList(),
    );
  }

  /// Détail complet d'un relevé (avec la maintenance d'origine).
  Future<ReleveDetail> getById(String id) async {
    return _client.request(
      (dio) => dio.get('/releves/$id'),
      (data) => ReleveDetail.fromJson(data['data'] as Map<String, dynamic>),
    );
  }

  Future<SubmitResult> create({
    required String siteId,
    required String source,
    double? indexCompteur,
    double? consommationKwh,
    double? volumeGasoilLitres,
    double? heuresFonctGE,
    String? observations,
    double? latitude,
    double? longitude,
  }) {
    return _sync.submit(
      endpoint: '/releves',
      entityType: 'releve',
      payload: {
        'siteId': siteId,
        'source': source,
        'dateReleve': DateTime.now().toUtc().toIso8601String(),
        if (indexCompteur != null) 'indexCompteur': indexCompteur,
        if (consommationKwh != null) 'consommationKwh': consommationKwh,
        if (volumeGasoilLitres != null) 'volumeGasoilLitres': volumeGasoilLitres,
        if (heuresFonctGE != null) 'heuresFonctGE': heuresFonctGE,
        if (observations != null && observations.isNotEmpty) 'observations': observations,
        if (latitude != null) 'latitude': latitude,
        if (longitude != null) 'longitude': longitude,
      },
    );
  }
}
