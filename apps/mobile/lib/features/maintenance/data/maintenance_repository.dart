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

  Future<List<Maintenance>> getMaintenances({String? statut, String? type, String? search, String? siteId}) async {
    if (!await _network.isConnected) return [];
    return _client.request(
      (dio) => dio.get('/maintenances', queryParameters: {
        'limit': 50,
        if (statut != null && statut.isNotEmpty) 'statut': statut,
        if (type != null && type.isNotEmpty) 'type': type,
        if (search != null && search.isNotEmpty) 'search': search,
        if (siteId != null && siteId.isNotEmpty) 'site_id': siteId,
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

  /// Actifs candidats pour un travail de cycle de vie (au dépôt pour une pose,
  /// en service pour une dépose/déplacement).
  Future<List<ActifLite>> getActifs({String? statut, bool enStock = false, String? type, String? siteId}) async {
    if (!await _network.isConnected) return [];
    return _client.request(
      (dio) => dio.get('/actifs', queryParameters: {
        if (statut != null && statut.isNotEmpty) 'statut': statut,
        if (enStock) 'en_stock': 'true',
        if (type != null) 'type': type,
        if (siteId != null) 'site_id': siteId,
      }),
      (data) => (data['data'] as List).map((e) => ActifLite.fromJson(e as Map<String, dynamic>)).toList(),
    );
  }

  /// Résout le site d'un actif (scan QR d'un GE) → renvoie son siteId, ou null
  /// s'il n'est rattaché à aucun site (au dépôt) ou introuvable.
  Future<String?> resolveActifSiteId(String type, String id) async {
    if (!await _network.isConnected) throw const ServerException('Résolution impossible hors-ligne');
    return _client.request(
      (dio) => dio.get('/actifs/$type/$id'),
      (data) => (data['data'] as Map<String, dynamic>)['siteId'] as String?,
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
    String? natureTravaux,
    String? actifType,
    String? actifId,
    String? siteSourceId,
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
        if (natureTravaux != null && natureTravaux != 'ENTRETIEN') 'natureTravaux': natureTravaux,
        if (actifType != null) 'actifType': actifType,
        if (actifId != null) 'actifId': actifId,
        if (siteSourceId != null) 'siteSourceId': siteSourceId,
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

  /// Suspension (urgence sur un autre site) : motif obligatoire, libère le
  /// verrou « une seule maintenance en cours ».
  Future<SubmitResult> suspend(String id, {required String motif}) => _sync.submit(
        endpoint: '/maintenances/$id/suspend',
        entityType: 'maintenance_suspend',
        payload: {'motif': motif},
      );

  /// Reprise sur site (GPS vérifié côté serveur, comme un démarrage).
  Future<SubmitResult> resume(String id, {double? latitude, double? longitude}) => _sync.submit(
        endpoint: '/maintenances/$id/resume',
        entityType: 'maintenance_resume',
        payload: {if (latitude != null) 'latitude': latitude, if (longitude != null) 'longitude': longitude},
      );

  /// Clôture offline-first.
  /// [photoPaths] et [signatureLocalPath] sont des chemins de fichiers LOCAUX
  /// (photos prises à la caméra, signature). Ils sont uploadés vers MinIO par le
  /// moteur de sync — immédiatement si en ligne, sinon à la reconnexion.
  Future<SubmitResult> close(
    String id, {
    required bool agentPresent,
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
        'agentPresent': agentPresent,
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
