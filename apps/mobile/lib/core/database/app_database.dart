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
      (select(cachedSites)..orderBy([(t) => OrderingTerm(expression: t.code)])).get();

  Future<CachedSite?> getCachedSite(String id) =>
      (select(cachedSites)..where((t) => t.id.equals(id))).getSingleOrNull();

  // ── Outbox ─────────────────────────────────────────────────
  Future<int> enqueue(OutboxEntriesCompanion entry) => into(outboxEntries).insert(entry);

  Future<List<OutboxEntry>> pendingOutbox() =>
      (select(outboxEntries)..orderBy([(t) => OrderingTerm(expression: t.createdAt)])).get();

  Future<void> removeOutbox(int localId) =>
      (delete(outboxEntries)..where((t) => t.localId.equals(localId))).go();

  Future<void> markOutboxError(int localId, int retries, String error) =>
      (update(outboxEntries)..where((t) => t.localId.equals(localId)))
          .write(OutboxEntriesCompanion(retries: Value(retries), lastError: Value(error)));

  Stream<int> watchOutboxCount() {
    final count = outboxEntries.localId.count();
    final q = selectOnly(outboxEntries)..addColumns([count]);
    return q.map((row) => row.read(count) ?? 0).watchSingle();
  }
}

QueryExecutor _openConnection() => driftDatabase(name: 'telecom_db');
