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
  DateTimeColumn get createdAt => dateTime().withDefault(currentDateAndTime)();
}

@DriftDatabase(tables: [CachedSites, OutboxEntries])
class AppDatabase extends _$AppDatabase {
  AppDatabase() : super(_openConnection());

  @override
  int get schemaVersion => 1;

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
  Future<List<OutboxEntry>> pendingOutbox() =>
      (select(outboxEntries)
            ..where((t) => t.retries.isSmallerThanValue(kMaxRetries))
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

  /// Relance manuelle d'une entrée en échec : compteur remis à zéro.
  Future<void> retryOutbox(int localId) =>
      (update(outboxEntries)..where((t) => t.localId.equals(localId)))
          .write(const OutboxEntriesCompanion(retries: Value(0), lastError: Value(null)));

  /// Nombre d'opérations encore à envoyer (hors échecs permanents).
  Stream<int> watchOutboxCount() {
    final count = outboxEntries.localId.count();
    final q = selectOnly(outboxEntries)
      ..addColumns([count])
      ..where(outboxEntries.retries.isSmallerThanValue(kMaxRetries));
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
