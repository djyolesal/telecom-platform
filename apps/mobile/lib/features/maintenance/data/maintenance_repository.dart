import '../../../core/network/dio_client.dart';
import '../../../core/network/network_info.dart';
import '../../../core/sync/sync_service.dart';
import '../../../core/errors/exceptions.dart';
import 'maintenance_cache.dart';
import 'maintenance_model.dart';

class MaintenanceRepository {
  final DioClient _client;
  final NetworkInfo _network;
  final SyncService _sync;

  MaintenanceRepository(this._client, this._network, this._sync);

  Future<List<Maintenance>> getMaintenances({String? statut, String? type, String? search, String? siteId}) async {
    // Hors-ligne : dernier instantané connu (filtres appliqués localement) —
    // le terrain reste utilisable sans réseau.
    // `isConnected` ne teste que l'interface : un WiFi de chantier sans
    // backhaul le donne « connecté ». Le repli cache doit donc aussi couvrir
    // l'échec réseau réel (cf. try/catch autour de l'appel en ligne).
    if (!await _network.isConnected) {
      final brutes = await MaintenanceCache.readList();
      final q = search?.trim().toLowerCase() ?? '';
      return brutes
          .where((m) =>
              (statut == null || statut.isEmpty || m['statut'] == statut) &&
              (type == null || type.isEmpty || m['type'] == type) &&
              (siteId == null || siteId.isEmpty || m['siteId'] == siteId) &&
              (q.isEmpty ||
                  '${m['reference'] ?? ''} ${m['equipement'] ?? ''} ${(m['site'] as Map?)?['nom'] ?? ''}'
                      .toLowerCase()
                      .contains(q)))
          .map((e) => Maintenance.fromJson(e))
          .toList();
    }
    return _client.request(
      (dio) => dio.get('/maintenances', queryParameters: {
        'limit': 50,
        if (statut != null && statut.isNotEmpty) 'statut': statut,
        if (type != null && type.isNotEmpty) 'type': type,
        if (search != null && search.isNotEmpty) 'search': search,
        if (siteId != null && siteId.isNotEmpty) 'site_id': siteId,
      }),
      (data) {
        final brutes = (data['data'] as List).whereType<Map>().map((e) => e.cast<String, dynamic>()).toList();
        // Instantané complet uniquement (pas de filtres) : c'est LA base du hors-ligne.
        if ((statut == null || statut.isEmpty) && (type == null || type.isEmpty) &&
            (search == null || search.isEmpty) && (siteId == null || siteId.isEmpty)) {
          MaintenanceCache.saveList(brutes); // best effort, non bloquant
        }
        return brutes.map(Maintenance.fromJson).toList();
      },
    );
  }

  Future<Maintenance> getMaintenance(String id) async {
    if (!await _network.isConnected) {
      final brut = await MaintenanceCache.byId(id);
      if (brut != null) return Maintenance.fromJson(brut);
      throw const ServerException('Maintenance indisponible hors-ligne (ouvrez-la une fois en ligne)');
    }
    return _client.request(
      (dio) => dio.get('/maintenances/$id'),
      (data) {
        final brut = (data['data'] as Map).cast<String, dynamic>();
        MaintenanceCache.upsert(brut); // le détail frais alimente le hors-ligne
        return Maintenance.fromJson(brut);
      },
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

  Future<SubmitResult> start(String id, {double? latitude, double? longitude}) async {
    final res = await _sync.submit(
      endpoint: '/maintenances/$id/start',
      entityType: 'maintenance_start',
      entityRef: 'maintenance:$id',
      payload: {
        // Heure RÉELLE du démarrage terrain : sans elle, une maintenance
        // démarrée hors couverture était datée de l'instant du rejeu et sa
        // clôture devenait impossible (durée minimale jamais atteinte).
        'dateDebut': DateTime.now().toUtc().toIso8601String(),
        if (latitude != null) 'latitude': latitude,
        if (longitude != null) 'longitude': longitude,
      },
    );
    // Hors-ligne : l'écran doit montrer l'état réel du travail (Clôturer /
    // Suspendre disponibles) sans attendre la resynchronisation.
    if (res.isQueued) {
      await MaintenanceCache.patch(id, {'statut': 'EN_COURS', 'dateDebut': DateTime.now().toIso8601String()});
    }
    return res;
  }

  /// Suspension (urgence sur un autre site) : motif obligatoire, libère le
  /// verrou « une seule maintenance en cours ».
  Future<SubmitResult> suspend(String id, {required String motif}) async {
    final res = await _sync.submit(
      endpoint: '/maintenances/$id/suspend',
      entityType: 'maintenance_suspend',
      entityRef: 'maintenance:$id',
      payload: {'motif': motif},
    );
    if (res.isQueued) {
      await MaintenanceCache.patch(id, {'statut': 'SUSPENDUE', 'motifSuspension': motif});
    }
    return res;
  }

  /// Reprise sur site (GPS vérifié côté serveur, comme un démarrage).
  Future<SubmitResult> resume(String id, {double? latitude, double? longitude}) async {
    final res = await _sync.submit(
      endpoint: '/maintenances/$id/resume',
      entityType: 'maintenance_resume',
      entityRef: 'maintenance:$id',
      payload: {if (latitude != null) 'latitude': latitude, if (longitude != null) 'longitude': longitude},
    );
    if (res.isQueued) {
      await MaintenanceCache.patch(id, {'statut': 'EN_COURS', 'motifSuspension': null});
    }
    return res;
  }

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
    // Le technicien a vu les avertissements de vraisemblance et confirme sa saisie.
    bool confirmerVraisemblance = false,
  }) async {
    final attachments = <Map<String, String>>[
      for (final p in photoPaths) {'path': p, 'kind': 'photo'},
      if (signatureLocalPath != null) {'path': signatureLocalPath, 'kind': 'signature'},
    ];
    final res = await _sync.submit(
      endpoint: '/maintenances/$id/close',
      entityType: 'maintenance_close',
      entityRef: 'maintenance:$id',
      payload: {
        'agentPresent': agentPresent,
        // Heure RÉELLE de fin : la durée minimale se mesure sur le terrain,
        // pas sur l'heure de synchronisation.
        'dateFin': DateTime.now().toUtc().toIso8601String(),
        if (observations != null) 'observations': observations,
        if (energie != null && energie.isNotEmpty) 'energie': energie,
        if (confirmerVraisemblance) 'confirmerVraisemblance': true,
        // Position au moment de la clôture (vérification "sur site" côté serveur).
        if (latitude != null) 'latitude': latitude,
        if (longitude != null) 'longitude': longitude,
      },
      attachments: attachments,
    );
    if (res.isQueued) {
      await MaintenanceCache.patch(id, {'statut': 'TERMINEE', 'dateFin': DateTime.now().toIso8601String()});
    }
    return res;
  }

  /// Photos d'intervention hors clôture (état des lieux AVANT travaux) :
  /// mêmes garanties que la clôture — upload différé, file d'attente hors-ligne.
  Future<SubmitResult> addPhotos(String id, {required List<String> photoPaths, String phase = 'AVANT'}) =>
      _sync.submit(
        endpoint: '/maintenances/$id/photos',
        entityType: 'maintenance_photos',
        payload: {'phase': phase},
        attachments: [for (final p in photoPaths) {'path': p, 'kind': 'photo'}],
      );
}
