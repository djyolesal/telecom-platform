import '../../../core/network/dio_client.dart';
import '../../../core/network/network_info.dart';
import '../../../core/sync/sync_service.dart';
import '../../../core/errors/exceptions.dart';
import 'incident_model.dart';

class IncidentRepository {
  final DioClient _client;
  final NetworkInfo _network;
  final SyncService _sync;

  IncidentRepository(this._client, this._network, this._sync);

  Future<List<Incident>> getIncidents(
      {String? statut, String? severite, String? search}) async {
    if (!await _network.isConnected) return [];
    return _client.request(
      (dio) => dio.get('/incidents', queryParameters: {
        'limit': 50,
        if (statut != null && statut.isNotEmpty) 'statut': statut,
        if (severite != null && severite.isNotEmpty) 'severite': severite,
        if (search != null && search.isNotEmpty) 'search': search,
      }),
      (data) => (data['data'] as List)
          .map((e) => Incident.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }

  Future<Incident> getIncident(String id) async {
    if (!await _network.isConnected) {
      throw const ServerException('Incident indisponible hors-ligne');
    }
    return _client.request(
      (dio) => dio.get('/incidents/$id'),
      (data) => Incident.fromJson(data['data'] as Map<String, dynamic>),
    );
  }

  /// Déclaration offline-first.
  Future<SubmitResult> declare({
    required String siteId,
    required String type,
    required String severite,
    required String description,
    double? latitude,
    double? longitude,
  }) {
    return _sync.submit(
      endpoint: '/incidents',
      entityType: 'incident',
      payload: {
        'siteId': siteId,
        'type': type,
        'severite': severite,
        'description': description,
        if (latitude != null) 'latitude': latitude,
        if (longitude != null) 'longitude': longitude,
      },
    );
  }

  /// Démarrage de l'intervention (offline-first) — vérifié SUR SITE côté serveur.
  Future<SubmitResult> start(String id,
          {double? latitude, double? longitude}) =>
      _sync.submit(
        endpoint: '/incidents/$id/demarrer',
        entityType: 'incident_start',
        payload: {
          if (latitude != null) 'latitude': latitude,
          if (longitude != null) 'longitude': longitude
        },
      );

  /// Clôture offline-first. [photoPaths] : chemins LOCAUX des photos prises sur
  /// place (≥ 6 exigées côté serveur) — uploadées par le moteur de sync,
  /// immédiatement si en ligne, sinon à la reconnexion.
  Future<SubmitResult> close({
    required String id,
    required DateTime dateResolution,
    required bool agentPresent,
    String? causeProbable,
    String? actionCorrective,
    // Classement de la panne : 'ACTIF' (radio/transmission) ou 'PASSIF' (énergie).
    String? causeCategorie,
    bool creerMaintenance = false,
    List<String> photoPaths = const [],
    double? latitude,
    double? longitude,
  }) {
    return _sync.submit(
      endpoint: '/incidents/$id/close',
      entityType: 'incident_close',
      payload: {
        'dateResolution': dateResolution.toUtc().toIso8601String(),
        'agentPresent': agentPresent,
        if (causeProbable != null && causeProbable.isNotEmpty)
          'causeProbable': causeProbable,
        if (actionCorrective != null && actionCorrective.isNotEmpty)
          'actionCorrective': actionCorrective,
        if (causeCategorie != null && causeCategorie.isNotEmpty)
          'causeCategorie': causeCategorie,
        'creerMaintenance': creerMaintenance,
        // Position au moment de la clôture (vérification « sur site » côté serveur).
        if (latitude != null) 'latitude': latitude,
        if (longitude != null) 'longitude': longitude,
      },
      attachments: [
        for (final p in photoPaths) {'path': p, 'kind': 'photo'},
      ],
    );
  }
}
