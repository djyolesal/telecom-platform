import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:dio/dio.dart' show Options;
import 'package:drift/drift.dart';
import 'package:logger/logger.dart';
import 'package:uuid/uuid.dart';
import '../database/app_database.dart';
import '../network/dio_client.dart';
import '../network/network_info.dart';
import '../services/upload_service.dart';
import '../errors/exceptions.dart';

/// Résultat d'une soumission d'écriture.
enum SubmitOutcome { sent, queued }

class SubmitResult {
  final SubmitOutcome outcome;
  final Map<String, dynamic>? data; // données retournées par l'API si envoyé
  const SubmitResult(this.outcome, [this.data]);
  bool get isQueued => outcome == SubmitOutcome.queued;
}

/// Moteur de synchronisation offline-first.
/// - Les écritures hors-ligne sont mises en file (outbox) et rejouées à la reconnexion.
/// - Expose le nombre d'opérations en attente.
class SyncService {
  final AppDatabase _db;
  final DioClient _client;
  final NetworkInfo _network;
  final UploadService _upload;
  final _logger = Logger(printer: PrettyPrinter(methodCount: 0));
  final _uuid = const Uuid();

  StreamSubscription<bool>? _connSub;
  bool _syncing = false;

  SyncService(this._db, this._client, this._network, this._upload);

  /// Démarre l'écoute de la connectivité pour synchroniser automatiquement.
  void start() {
    _connSub = _network.onStatusChange.listen((online) {
      if (online) sync();
    });
  }

  void dispose() => _connSub?.cancel();

  Stream<int> get pendingCount => _db.watchOutboxCount();

  /// Soumet une écriture : envoie immédiatement si en ligne, sinon met en file.
  ///
  /// [attachments] : fichiers locaux (photos prises à la caméra, signature) à
  /// uploader vers MinIO **avant** l'envoi. Chaque entrée = {'path': chemin local
  /// persistant, 'kind': 'photo'|'signature'}. L'upload est différé : s'il échoue
  /// (hors-ligne), tout est mis en file et rejoué automatiquement à la reconnexion.
  Future<SubmitResult> submit({
    required String endpoint,
    required String entityType,
    required Map<String, dynamic> payload,
    String method = 'POST',
    List<Map<String, String>>? attachments,
  }) async {
    // clientUuid sert uniquement au suivi local (outbox) — il n'est PAS envoyé
    // au serveur, sinon Prisma rejette ce champ inconnu (erreur 500).
    final clientUuid = _uuid.v4();
    final body = Map<String, dynamic>.from(payload);
    // Les pièces jointes locales voyagent DANS le payload stocké (clé réservée
    // `_attachments`), retirée avant l'envoi réel → pas de migration Drift.
    if (attachments != null && attachments.isNotEmpty) {
      body['_attachments'] = attachments;
    }

    // On tente TOUJOURS l'envoi direct (le pré-check de connectivité n'est pas
    // fiable, notamment sur émulateur). On ne met en file que si le réseau échoue
    // réellement (NetworkException). Une erreur serveur (4xx/5xx) est, elle, relancée.
    try {
      final data = await _process(endpoint, method, Map<String, dynamic>.from(body));
      return SubmitResult(SubmitOutcome.sent, data);
    } on NetworkException {
      // hors-ligne réel (ou upload des photos impossible) → file d'attente
    }

    await _db.enqueue(OutboxEntriesCompanion.insert(
      endpoint: endpoint,
      method: Value(method),
      payload: jsonEncode(body),
      entityType: entityType,
      clientUuid: clientUuid,
    ));
    return const SubmitResult(SubmitOutcome.queued);
  }

  /// Rejoue toutes les opérations en attente.
  Future<void> sync() async {
    if (_syncing) return;
    // On tente le drainage sans se fier au pré-check de connectivité :
    // chaque envoi qui échoue pour cause réseau interrompt la boucle (réessai plus tard).
    _syncing = true;
    try {
      final pending = await _db.pendingOutbox();
      for (final entry in pending) {
        try {
          final payload = jsonDecode(entry.payload) as Map<String, dynamic>;
          await _process(entry.endpoint, entry.method, payload);
          await _db.removeOutbox(entry.localId);
          _logger.i('[sync] ${entry.entityType} envoyé (${entry.endpoint})');
        } on NetworkException {
          break; // réseau coupé (ou upload photos KO) → on réessaiera plus tard
        } catch (e) {
          // Erreur serveur (ex: validation) → on incrémente le compteur et on abandonne après 5 essais
          final retries = entry.retries + 1;
          await _db.markOutboxError(entry.localId, retries, e.toString());
          if (retries >= 5) {
            await _db.removeOutbox(entry.localId);
            _logger.w('[sync] ${entry.entityType} abandonné après 5 tentatives');
          }
        }
      }
    } finally {
      _syncing = false;
    }
  }

  /// Prépare et envoie une opération : uploade d'abord les pièces jointes locales
  /// (`_attachments`) vers MinIO, injecte les clés dans le corps, puis POST.
  /// En cas d'échec d'upload (hors-ligne), lève NetworkException → mise en file.
  Future<Map<String, dynamic>?> _process(String endpoint, String method, Map<String, dynamic> body) async {
    final atts = (body.remove('_attachments') as List?) ?? const [];
    final uploadedPaths = <String>[];

    if (atts.isNotEmpty) {
      final photos = <Map<String, String>>[];
      for (final raw in atts) {
        final a = (raw as Map).cast<String, dynamic>();
        final path = a['path'] as String;
        final kind = (a['kind'] as String?) ?? 'photo';
        final file = File(path);
        if (!await file.exists()) continue; // fichier perdu → on ignore
        final up = await _upload.uploadImage(
          await file.readAsBytes(),
          path.split('/').last,
          folder: kind == 'signature' ? 'signatures' : 'photos',
        );
        if (up == null) {
          // upload impossible → réseau indisponible : on réessaiera (rien n'est supprimé)
          throw const NetworkException('Upload des pièces jointes impossible (hors-ligne)');
        }
        if (kind == 'signature') {
          body['signaturePath'] = up.key;
        } else {
          photos.add(up.toJson());
        }
        uploadedPaths.add(path);
      }
      if (photos.isNotEmpty) body['photos'] = photos;
    }

    final data = await _send(endpoint, method, body);

    // Envoi réussi → on libère les fichiers locaux mis en cache pour la sync.
    for (final p in uploadedPaths) {
      try {
        await File(p).delete();
      } catch (_) {/* best effort */}
    }
    return data;
  }

  Future<Map<String, dynamic>?> _send(String endpoint, String method, Map<String, dynamic> body) {
    return _client.request<Map<String, dynamic>?>(
      (dio) => dio.request(
        endpoint,
        data: body,
        options: Options(method: method),
      ),
      (data) => data is Map<String, dynamic> ? (data['data'] as Map<String, dynamic>?) : null,
    );
  }
}
