import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:dio/dio.dart' show Options;
import 'package:drift/drift.dart';
import 'package:logger/logger.dart';
import 'package:uuid/uuid.dart';
import '../database/app_database.dart';
import '../storage/secure_storage.dart';
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
  final SecureStorage _storage;
  final _logger = Logger(printer: PrettyPrinter(methodCount: 0));
  final _uuid = const Uuid();

  StreamSubscription<bool>? _connSub;
  bool _syncing = false;

  /// Appelé quand une opération à patch optimiste finit en échec définitif ou
  /// est abandonnée par l'utilisateur : révoque l'état optimiste du cache (ex.
  /// une maintenance affichée « Terminée » que le serveur n'a jamais acceptée).
  /// Injecté depuis `injection.dart` (évite de coupler la sync aux features).
  final Future<void> Function(String entityRef)? onOptimistiqueEchoue;

  SyncService(this._db, this._client, this._network, this._upload, this._storage,
      {this.onOptimistiqueEchoue});

  /// Démarre l'écoute de la connectivité pour synchroniser automatiquement.
  void start() {
    // Drainage immédiat : une app relancée déjà en ligne avec une file pleine ne
    // doit pas attendre un CHANGEMENT de connectivité pour envoyer ses opérations.
    sync();
    _connSub = _network.onStatusChange.listen((online) {
      if (online) sync();
    });
  }

  void dispose() => _connSub?.cancel();

  Stream<int> get pendingCount => _db.watchOutboxCount();
  /// Nombre d'opérations actuellement en attente (instantané, pour le retour
  /// visuel du bouton de synchronisation manuelle).
  Future<int> enAttente() async =>
      (await _db.pendingOutbox(userId: await _storage.readUserId())).length;
  /// Opérations en échec permanent (à signaler à l'utilisateur pour revue).
  Stream<int> get failedCount => _db.watchFailedCount();
  Future<List<OutboxEntry>> failedEntries() => _db.failedOutbox();
  /// Relance manuelle d'une opération en échec (remet son compteur à zéro).
  Future<void> retryFailed(int localId) async {
    await _db.retryOutbox(localId);
    await sync();
  }

  /// Opérations en attente d'une confirmation utilisateur (« valeurs
  /// inhabituelles » reçues au rejeu hors-ligne). Sans ce canal, elles
  /// restaient bloquées à vie, ni rejouées ni visibles.
  Stream<int> get confirmationCount => _db.watchConfirmationCount();
  Future<List<OutboxEntry>> confirmationsEnAttente() async =>
      _db.outboxAConfirmer(userId: await _storage.readUserId());

  /// L'utilisateur confirme la saisie malgré les avertissements : le payload
  /// repart avec le drapeau `confirmerVraisemblance` et est rejoué.
  Future<void> confirmer(OutboxEntry entry) async {
    final body = jsonDecode(entry.payload) as Map<String, dynamic>;
    body['confirmerVraisemblance'] = true;
    await _db.confirmerOutbox(entry.localId, jsonEncode(body));
    await sync();
  }

  /// L'utilisateur abandonne la saisie : l'entrée est retirée de la file et
  /// l'éventuel patch optimiste du cache est révoqué (l'écran ne montre plus
  /// une opération « validée » qui ne l'a jamais été).
  Future<void> annulerConfirmation(OutboxEntry entry) async {
    if (entry.entityRef != null) await onOptimistiqueEchoue?.call(entry.entityRef!);
    await _db.removeOutbox(entry.localId);
  }

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
    /// Entité visée (« maintenance:<id> ») : sert à révoquer le patch optimiste
    /// du cache si l'opération finit par être refusée.
    String? entityRef,
  }) async {
    // clientUuid : STABLE entre l'envoi direct et un éventuel rejeu depuis la file.
    // Transmis au serveur via le header `Idempotency-Key` (clé réservée `_idem`
    // dans le payload stocké, retirée avant l'envoi) → le serveur déduplique un
    // dépotage/relevé dont la réponse a été perdue sur réseau lent. Pas dans le
    // corps JSON : aucun risque pour les endpoints à liste blanche stricte.
    final clientUuid = _uuid.v4();
    final body = Map<String, dynamic>.from(payload);
    body['_idem'] = clientUuid;
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
    } on UnauthorizedException {
      // Session invalidée (token expiré non rafraîchissable, ou « ouverte sur un
      // autre appareil ») : la saisie terrain ne doit PAS être perdue → file
      // d'attente. Elle repartira après reconnexion, comme le hors-ligne.
    }

    await _db.enqueue(OutboxEntriesCompanion.insert(
      endpoint: endpoint,
      method: Value(method),
      payload: jsonEncode(body),
      entityType: entityType,
      clientUuid: clientUuid,
      // Auteur : la file d'un technicien ne doit jamais être rejouée avec le
      // jeton d'un autre (téléphone de service partagé).
      userId: Value(await _storage.readUserId()),
      entityRef: Value(entityRef),
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
      final pending = await _db.pendingOutbox(userId: await _storage.readUserId());
      for (final entry in pending) {
        try {
          final payload = jsonDecode(entry.payload) as Map<String, dynamic>;
          await _process(entry.endpoint, entry.method, payload, localId: entry.localId);
          await _db.removeOutbox(entry.localId);
          _logger.i('[sync] ${entry.entityType} envoyé (${entry.endpoint})');
        } on NetworkException {
          // Distinguer un VRAI hors-ligne d'un timeout propre à CETTE entrée :
          // `receiveTimeout` (serveur lent, grosse photo sur lien 2G) est aussi
          // mappé en NetworkException. Si l'appareil est réellement hors-ligne,
          // on s'arrête sans brûler d'essai (rien n'est perdu). S'il est en
          // ligne, l'entrée en tête a juste expiré : la laisser bloquerait TOUTE
          // la file derrière - on compte un essai et on passe à la suivante.
          if (!await _network.isConnected) break;
          await _compterEchec(entry, 'Délai réseau dépassé sur cette opération');
          continue;
        } on UnauthorizedException {
          // Session invalidée : on ARRÊTE le drainage sans compter d'essai (sinon
          // un 401 pendant une oscillation réseau brûlerait les 5 essais de TOUTE
          // la file). La reconnexion relancera sync() ; rien n'est perdu.
          break;
        } on ServerException catch (e) {
          // 422 « valeurs inhabituelles » : l'opération est VALIDE, elle attend
          // seulement l'accord du technicien. La rejouer jusqu'à l'échec
          // définitif la condamnait sans aucun recours possible.
          if (e.confirmationRequise) {
            await _db.marquerConfirmationRequise(entry.localId, e.avertissements.join('\n'));
            _logger.w('[sync] ${entry.entityType} en attente de confirmation');
            continue;
          }
          // Refus de VALIDATION (4xx) : rejouer le même corps ne donnera jamais
          // un autre résultat - 5 rejeux silencieux masquaient le vrai message
          // du serveur pendant des heures (« ça ne synchronise pas »). Échec
          // immédiat, visible dans le bandeau avec le motif exact.
          final code = e.statusCode ?? 0;
          if (code >= 400 && code < 500) {
            await _echecImmediat(entry, e.toString());
            continue;
          }
          await _compterEchec(entry, e.toString());
        } catch (e) {
          // Erreur SERVEUR (validation, refus…) propre à CETTE entrée : on compte
          // un essai et on CONTINUE avec les suivantes (pas de blocage en tête).
          await _compterEchec(entry, e.toString());
        }
      }
    } finally {
      _syncing = false;
    }
  }

  /// Échec DÉFINITIF immédiat (refus de validation) : l'entrée est conservée et
  /// visible dans les échecs avec le message serveur, le patch optimiste révoqué.
  Future<void> _echecImmediat(OutboxEntry entry, String erreur) async {
    await _db.markOutboxError(entry.localId, AppDatabase.kMaxRetries, erreur);
    _logger.w('[sync] ${entry.entityType} refusé par le serveur (${entry.endpoint}) : $erreur');
    if (entry.entityRef != null) await onOptimistiqueEchoue?.call(entry.entityRef!);
  }

  /// Compte un essai raté sur une entrée et, au passage en échec DÉFINITIF,
  /// révoque son patch optimiste (sinon l'écran continue d'afficher une
  /// opération « validée » que le serveur n'a jamais acceptée). L'entrée reste
  /// en base (jamais supprimée) : visible dans les échecs, rejouable à la main.
  Future<void> _compterEchec(OutboxEntry entry, String erreur) async {
    final retries = entry.retries + 1;
    await _db.markOutboxError(entry.localId, retries, erreur);
    if (retries >= AppDatabase.kMaxRetries) {
      _logger.w('[sync] ${entry.entityType} en échec (${entry.endpoint}) - conservé pour revue manuelle');
      if (entry.entityRef != null) await onOptimistiqueEchoue?.call(entry.entityRef!);
    }
  }

  /// Prépare et envoie une opération : uploade d'abord les pièces jointes locales
  /// (`_attachments`) vers MinIO, injecte les clés dans le corps, puis POST.
  /// En cas d'échec d'upload (hors-ligne), lève NetworkException → mise en file.
  /// [localId] : quand l'opération vient de la FILE, chaque pièce jointe envoyée
  /// est retirée du payload stocké et sa clé MinIO y est injectée. Sans ce point
  /// de reprise, une coupure à la 8e photo faisait tout recommencer à la 1re :
  /// sur un lien qui ne tient pas 5 minutes, l'opération ne partait JAMAIS.
  Future<Map<String, dynamic>?> _process(
    String endpoint,
    String method,
    Map<String, dynamic> body, {
    int? localId,
  }) async {
    final idempotencyKey = body.remove('_idem') as String?;
    final atts = List<dynamic>.from((body.remove('_attachments') as List?) ?? const []);
    final uploadedPaths = <String>[];
    var manquantes = 0;

    if (atts.isNotEmpty) {
      final photos = List<Map<String, dynamic>>.from(
        (body['photos'] as List?)?.map((e) => (e as Map).cast<String, dynamic>()) ?? const [],
      );
      while (atts.isNotEmpty) {
        final a = (atts.first as Map).cast<String, dynamic>();
        final path = a['path'] as String;
        final kind = (a['kind'] as String?) ?? 'photo';
        // `field` cible une clé arbitraire du corps (ex: signatureChauffeurPath,
        // blPdfPath…). Sinon : 'photo' → tableau photos, 'signature' → signaturePath.
        final field = a['field'] as String?;
        final folder = (a['folder'] as String?) ?? (kind == 'signature' ? 'signatures' : 'photos');
        final file = File(path);
        if (!await file.exists()) {
          // Fichier disparu (nettoyage système, restauration) : on le compte —
          // partir amputé sans le dire ferait perdre la preuve terrain en silence.
          manquantes++;
          atts.removeAt(0);
          continue;
        }
        final up = await _upload.uploadImage(
          await file.readAsBytes(),
          path.split('/').last,
          folder: folder,
        );
        if (up == null) {
          // upload impossible → réseau indisponible : on réessaiera (rien n'est supprimé)
          throw const NetworkException('Upload des pièces jointes impossible (hors-ligne)');
        }
        if (field != null) {
          body[field] = up.key;
        } else if (kind == 'signature') {
          body['signaturePath'] = up.key;
        } else {
          photos.add(up.toJson());
        }
        uploadedPaths.add(path);
        atts.removeAt(0);
        // Point de reprise : ce qui est envoyé ne le sera plus jamais deux fois.
        if (localId != null) {
          final restant = Map<String, dynamic>.from(body);
          if (photos.isNotEmpty) restant['photos'] = photos;
          if (idempotencyKey != null) restant['_idem'] = idempotencyKey;
          if (atts.isNotEmpty) restant['_attachments'] = atts;
          await _db.updateOutboxPayload(localId, jsonEncode(restant));
        }
      }
      if (photos.isNotEmpty) body['photos'] = photos;
      if (manquantes > 0) {
        _logger.w('[sync] $manquantes pièce(s) jointe(s) introuvable(s) - opération envoyée sans elles');
      }
    }

    final data = await _send(endpoint, method, body, idempotencyKey);

    // Envoi réussi → on libère les fichiers locaux mis en cache pour la sync.
    for (final p in uploadedPaths) {
      try {
        await File(p).delete();
      } catch (_) {/* best effort */}
    }
    return data;
  }

  Future<Map<String, dynamic>?> _send(String endpoint, String method, Map<String, dynamic> body, [String? idempotencyKey]) {
    return _client.request<Map<String, dynamic>?>(
      (dio) => dio.request(
        endpoint,
        data: body,
        options: Options(
          method: method,
          headers: idempotencyKey != null ? {'Idempotency-Key': idempotencyKey} : null,
        ),
      ),
      (data) => data is Map<String, dynamic> ? (data['data'] as Map<String, dynamic>?) : null,
    );
  }
}
