import '../../../core/network/dio_client.dart';
import '../../../core/network/network_info.dart';
import '../../../core/sync/sync_service.dart';
import '../../../core/errors/exceptions.dart';
import 'maintenance_model.dart';

class MaintenanceRepository {
  final DioClient _client;
  final NetworkInfo _network;
  final SyncService _sync;

  MaintenanceRepository(this._client, this._network, this._sync);

  Future<List<Maintenance>> getMaintenances({String? statut, String? type}) async {
    if (!await _network.isConnected) return [];
    return _client.request(
      (dio) => dio.get('/maintenances', queryParameters: {
        'limit': 50,
        if (statut != null && statut.isNotEmpty) 'statut': statut,
        if (type != null && type.isNotEmpty) 'type': type,
      }),
      (data) => (data['data'] as List).map((e) => Maintenance.fromJson(e as Map<String, dynamic>)).toList(),
    );
  }

  Future<Maintenance> getMaintenance(String id) async {
    if (!await _network.isConnected) throw const ServerException('Maintenance indisponible hors-ligne');
    return _client.request(
      (dio) => dio.get('/maintenances/$id'),
      (data) => Maintenance.fromJson(data['data'] as Map<String, dynamic>),
    );
  }

  /// Création offline-first (mise en file si hors-ligne).
  Future<SubmitResult> create({
    required String siteId,
    required String type,
    required String categorie,
    required String equipement,
    String? description,
    required DateTime datePlanifiee,
    double? latitude,
    double? longitude,
    String? tachePreventiveKey,
  }) {
    return _sync.submit(
      endpoint: '/maintenances',
      entityType: 'maintenance',
      payload: {
        'siteId': siteId,
        'type': type,
        'categorie': categorie,
        'equipement': equipement,
        if (tachePreventiveKey != null) 'tachePreventiveKey': tachePreventiveKey,
        if (description != null && description.isNotEmpty) 'description': description,
        'datePlanifiee': datePlanifiee.toUtc().toIso8601String(),
        // NB : le modèle Maintenance n'a pas de latitude/longitude à la création
        // (la position est enregistrée au démarrage via latitudeDebut/longitudeDebut).
      },
    );
  }

  Future<SubmitResult> start(String id, {double? latitude, double? longitude}) => _sync.submit(
        endpoint: '/maintenances/$id/start',
        entityType: 'maintenance_start',
        payload: {if (latitude != null) 'latitude': latitude, if (longitude != null) 'longitude': longitude},
      );

  /// Clôture offline-first.
  /// [photoPaths] et [signatureLocalPath] sont des chemins de fichiers LOCAUX
  /// (photos prises à la caméra, signature). Ils sont uploadés vers MinIO par le
  /// moteur de sync — immédiatement si en ligne, sinon à la reconnexion.
  Future<SubmitResult> close(
    String id, {
    String? observations,
    String? signatureLocalPath,
    Map<String, dynamic>? energie,
    List<String> photoPaths = const [],
    double? latitude,
    double? longitude,
  }) {
    final attachments = <Map<String, String>>[
      for (final p in photoPaths) {'path': p, 'kind': 'photo'},
      if (signatureLocalPath != null) {'path': signatureLocalPath, 'kind': 'signature'},
    ];
    return _sync.submit(
      endpoint: '/maintenances/$id/close',
      entityType: 'maintenance_close',
      payload: {
        if (observations != null) 'observations': observations,
        if (energie != null && energie.isNotEmpty) 'energie': energie,
        // Position au moment de la clôture (vérification "sur site" côté serveur).
        if (latitude != null) 'latitude': latitude,
        if (longitude != null) 'longitude': longitude,
      },
      attachments: attachments,
    );
  }
}
