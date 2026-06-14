import 'dart:async';
import 'dart:convert';
import 'package:dio/dio.dart' show Options;
import 'package:drift/drift.dart';
import 'package:logger/logger.dart';
import 'package:uuid/uuid.dart';
import '../database/app_database.dart';
import '../network/dio_client.dart';
import '../network/network_info.dart';
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
  final _logger = Logger(printer: PrettyPrinter(methodCount: 0));
  final _uuid = const Uuid();

  StreamSubscription<bool>? _connSub;
  bool _syncing = false;

  SyncService(this._db, this._client, this._network);

  /// Démarre l'écoute de la connectivité pour synchroniser automatiquement.
  void start() {
    _connSub = _network.onStatusChange.listen((online) {
      if (online) sync();
    });
  }

  void dispose() => _connSub?.cancel();

  Stream<int> get pendingCount => _db.watchOutboxCount();

  /// Soumet une écriture : envoie immédiatement si en ligne, sinon met en file.
  Future<SubmitResult> submit({
    required String endpoint,
    required String entityType,
    required Map<String, dynamic> payload,
    String method = 'POST',
  }) async {
    final body = Map<String, dynamic>.from(payload);
    body.putIfAbsent('clientUuid', () => _uuid.v4());

    if (await _network.isConnected) {
      try {
        final data = await _send(endpoint, method, body);
        return SubmitResult(SubmitOutcome.sent, data);
      } on NetworkException {
        // bascule hors-ligne → file d'attente
      }
    }

    await _db.enqueue(OutboxEntriesCompanion.insert(
      endpoint: endpoint,
      method: Value(method),
      payload: jsonEncode(body),
      entityType: entityType,
      clientUuid: body['clientUuid'] as String,
    ));
    return const SubmitResult(SubmitOutcome.queued);
  }

  /// Rejoue toutes les opérations en attente.
  Future<void> sync() async {
    if (_syncing) return;
    if (!await _network.isConnected) return;
    _syncing = true;
    try {
      final pending = await _db.pendingOutbox();
      for (final entry in pending) {
        try {
          final payload = jsonDecode(entry.payload) as Map<String, dynamic>;
          await _send(entry.endpoint, entry.method, payload);
          await _db.removeOutbox(entry.localId);
          _logger.i('[sync] ${entry.entityType} envoyé (${entry.endpoint})');
        } on NetworkException {
          break; // réseau coupé → on réessaiera plus tard
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
