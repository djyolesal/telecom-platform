import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';

part 'app_database.g.dart';

/// Cache local des sites pour la consultation hors-ligne.
@DataClassName('CachedSite')
class CachedSites extends Table {
  TextColumn get id => text()();
  TextColumn get code => text()();
  TextColumn get nom => text()();
  TextColumn get region => text()();
  TextColumn get ville => text().nullable()();
  TextColumn get powerConfig => text()();
  TextColumn get statutGe => text()();
  RealColumn get puissanceGeKva => real().withDefault(const Constant(0))();
  RealColumn get latitude => real().nullable()();
  RealColumn get longitude => real().nullable()();
  DateTimeColumn get cachedAt => dateTime().withDefault(currentDateAndTime)();

  @override
  Set<Column> get primaryKey => {id};
}

/// File d'attente des opérations d'écriture effectuées hors-ligne (outbox).
@DataClassName('OutboxEntry')
class OutboxEntries extends Table {
  IntColumn get localId => integer().autoIncrement()();
  TextColumn get endpoint => text()(); // ex: /maintenances
  TextColumn get method => text().withDefault(const Constant('POST'))();
  TextColumn get payload => text()(); // JSON encodé
  TextColumn get entityType => text()(); // maintenance, depotage, releve, incident
  TextColumn get clientUuid => text()();
  IntColumn get retries => integer().withDefault(const Constant(0))();
  TextColumn get lastError => text().nullable()();
  // Auteur de l'opération : sur un téléphone de service partagé, la file de A
  // était rejouée avec le jeton de B - saisies enregistrées au mauvais nom.
  TextColumn get userId => text().nullable()();
  // Entité visée (ex: « maintenance:<id> ») : permet de révoquer le patch
  // optimiste du cache quand l'opération finit en échec définitif.
  TextColumn get entityRef => text().nullable()();
  // 422 « valeurs inhabituelles » reçu en rejeu : l'opération attend une
  // confirmation explicite de l'utilisateur (elle n'est plus rejouée seule).
  BoolColumn get besoinConfirmation => boolean().withDefault(const Constant(false))();
  TextColumn get avertissements => text().nullable()();
  DateTimeColumn get createdAt => dateTime().withDefault(currentDateAndTime)();
}

@DriftDatabase(tables: [CachedSites, OutboxEntries])
class AppDatabase extends _$AppDatabase {
  AppDatabase() : super(_openConnection());

  @override
  int get schemaVersion => 2;

  @override
  MigrationStrategy get migration => MigrationStrategy(
        onCreate: (m) => m.createAll(),
        onUpgrade: (m, from, to) async {
          if (from < 2) {
            // Colonnes ajoutées par l'audit d'août 2026 (cloisonnement par
            // utilisateur, révocation de patch optimiste, confirmation 422).
            await m.addColumn(outboxEntries, outboxEntries.userId);
            await m.addColumn(outboxEntries, outboxEntries.entityRef);
            await m.addColumn(outboxEntries, outboxEntries.besoinConfirmation);
            await m.addColumn(outboxEntries, outboxEntries.avertissements);
          }
        },
      );

  // ── Cache sites ────────────────────────────────────────────
  Future<void> upsertSites(List<CachedSitesCompanion> sites) async {
    await batch((b) => b.insertAllOnConflictUpdate(cachedSites, sites));
  }

  Future<List<CachedSite>> getCachedSites() =>
      (select(cachedSites)..orderBy([(t) => OrderingTerm(expression: t.nom)])).get();

  Future<CachedSite?> getCachedSite(String id) =>
      (select(cachedSites)..where((t) => t.id.equals(id))).getSingleOrNull();

  // ── Outbox ─────────────────────────────────────────────────
  Future<int> enqueue(OutboxEntriesCompanion entry) => into(outboxEntries).insert(entry);

  // Seuil au-delà duquel une entrée cesse d'être rejouée automatiquement et
  // passe en « échec » (conservée en base, jamais supprimée → aucune perte).
  static const kMaxRetries = 5;

  /// File à rejouer : uniquement les entrées PAS encore en échec permanent,
  /// plus anciennes d'abord (tiebreaker localId = ordre d'insertion stable).
  Future<List<OutboxEntry>> pendingOutbox({String? userId}) =>
      (select(outboxEntries)
            ..where((t) => t.retries.isSmallerThanValue(kMaxRetries) & t.besoinConfirmation.equals(false)
                & (userId == null ? const Constant(true) : (t.userId.equals(userId) | t.userId.isNull())))
            ..orderBy([(t) => OrderingTerm(expression: t.createdAt), (t) => OrderingTerm(expression: t.localId)]))
          .get();

  /// Entrées en échec permanent (à présenter à l'utilisateur : réessayer/abandonner).
  Future<List<OutboxEntry>> failedOutbox() =>
      (select(outboxEntries)
            ..where((t) => t.retries.isBiggerOrEqualValue(kMaxRetries))
            ..orderBy([(t) => OrderingTerm(expression: t.createdAt)]))
          .get();

  Future<void> removeOutbox(int localId) =>
      (delete(outboxEntries)..where((t) => t.localId.equals(localId))).go();

  Future<void> markOutboxError(int localId, int retries, String error) =>
      (update(outboxEntries)..where((t) => t.localId.equals(localId)))
          .write(OutboxEntriesCompanion(retries: Value(retries), lastError: Value(error)));

  /// Point de reprise des uploads : réécrit le payload stocké après chaque
  /// pièce jointe envoyée (une coupure ne fait plus tout recommencer).
  Future<void> updateOutboxPayload(int localId, String payload) =>
      (update(outboxEntries)..where((t) => t.localId.equals(localId)))
          .write(OutboxEntriesCompanion(payload: Value(payload)));

  /// 422 « valeurs inhabituelles » en rejeu : l'entrée est mise en attente de
  /// confirmation explicite plutôt que rejouée jusqu'à l'échec définitif.
  Future<void> marquerConfirmationRequise(int localId, String avertissements) =>
      (update(outboxEntries)..where((t) => t.localId.equals(localId)))
          .write(OutboxEntriesCompanion(
            besoinConfirmation: const Value(true),
            avertissements: Value(avertissements),
          ));

  /// Entrées en attente d'une confirmation utilisateur (cloisonnées par auteur
  /// sur un téléphone de service partagé).
  Future<List<OutboxEntry>> outboxAConfirmer({String? userId}) =>
      (select(outboxEntries)
            ..where((t) => t.besoinConfirmation.equals(true) &
                (userId == null ? const Constant(true) : (t.userId.equals(userId) | t.userId.isNull())))
            ..orderBy([(t) => OrderingTerm(expression: t.createdAt)]))
          .get();

  /// L'utilisateur confirme : le payload repart avec le drapeau de confirmation.
  Future<void> confirmerOutbox(int localId, String payload) =>
      (update(outboxEntries)..where((t) => t.localId.equals(localId)))
          .write(OutboxEntriesCompanion(
            payload: Value(payload),
            besoinConfirmation: const Value(false),
            avertissements: const Value(null),
            retries: const Value(0),
            lastError: const Value(null),
          ));

  /// Relance manuelle d'une entrée en échec : compteur remis à zéro.
  Future<void> retryOutbox(int localId) =>
      (update(outboxEntries)..where((t) => t.localId.equals(localId)))
          .write(const OutboxEntriesCompanion(retries: Value(0), lastError: Value(null)));

  /// Nombre d'opérations encore à envoyer (hors échecs permanents ET hors
  /// entrées en attente de confirmation : celles-ci ont leur propre compteur,
  /// sinon le badge « en attente » restait à 1 pour toujours).
  Stream<int> watchOutboxCount() {
    final count = outboxEntries.localId.count();
    final q = selectOnly(outboxEntries)
      ..addColumns([count])
      ..where(outboxEntries.retries.isSmallerThanValue(kMaxRetries) &
          outboxEntries.besoinConfirmation.equals(false));
    return q.map((row) => row.read(count) ?? 0).watchSingle();
  }

  /// Nombre d'opérations en attente d'une confirmation de l'utilisateur.
  Stream<int> watchConfirmationCount() {
    final count = outboxEntries.localId.count();
    final q = selectOnly(outboxEntries)
      ..addColumns([count])
      ..where(outboxEntries.besoinConfirmation.equals(true));
    return q.map((row) => row.read(count) ?? 0).watchSingle();
  }

  /// Nombre d'opérations en échec permanent (à signaler à l'utilisateur).
  Stream<int> watchFailedCount() {
    final count = outboxEntries.localId.count();
    final q = selectOnly(outboxEntries)
      ..addColumns([count])
      ..where(outboxEntries.retries.isBiggerOrEqualValue(kMaxRetries));
    return q.map((row) => row.read(count) ?? 0).watchSingle();
  }
}

QueryExecutor _openConnection() => driftDatabase(name: 'telecom_db');
