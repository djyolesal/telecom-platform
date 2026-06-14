// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'app_database.dart';

// ignore_for_file: type=lint
class $CachedSitesTable extends CachedSites
    with TableInfo<$CachedSitesTable, CachedSite> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $CachedSitesTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
      'id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _codeMeta = const VerificationMeta('code');
  @override
  late final GeneratedColumn<String> code = GeneratedColumn<String>(
      'code', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _nomMeta = const VerificationMeta('nom');
  @override
  late final GeneratedColumn<String> nom = GeneratedColumn<String>(
      'nom', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _regionMeta = const VerificationMeta('region');
  @override
  late final GeneratedColumn<String> region = GeneratedColumn<String>(
      'region', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _villeMeta = const VerificationMeta('ville');
  @override
  late final GeneratedColumn<String> ville = GeneratedColumn<String>(
      'ville', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _powerConfigMeta =
      const VerificationMeta('powerConfig');
  @override
  late final GeneratedColumn<String> powerConfig = GeneratedColumn<String>(
      'power_config', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _statutGeMeta =
      const VerificationMeta('statutGe');
  @override
  late final GeneratedColumn<String> statutGe = GeneratedColumn<String>(
      'statut_ge', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _puissanceGeKvaMeta =
      const VerificationMeta('puissanceGeKva');
  @override
  late final GeneratedColumn<double> puissanceGeKva = GeneratedColumn<double>(
      'puissance_ge_kva', aliasedName, false,
      type: DriftSqlType.double,
      requiredDuringInsert: false,
      defaultValue: const Constant(0));
  static const VerificationMeta _latitudeMeta =
      const VerificationMeta('latitude');
  @override
  late final GeneratedColumn<double> latitude = GeneratedColumn<double>(
      'latitude', aliasedName, true,
      type: DriftSqlType.double, requiredDuringInsert: false);
  static const VerificationMeta _longitudeMeta =
      const VerificationMeta('longitude');
  @override
  late final GeneratedColumn<double> longitude = GeneratedColumn<double>(
      'longitude', aliasedName, true,
      type: DriftSqlType.double, requiredDuringInsert: false);
  static const VerificationMeta _cachedAtMeta =
      const VerificationMeta('cachedAt');
  @override
  late final GeneratedColumn<DateTime> cachedAt = GeneratedColumn<DateTime>(
      'cached_at', aliasedName, false,
      type: DriftSqlType.dateTime,
      requiredDuringInsert: false,
      defaultValue: currentDateAndTime);
  @override
  List<GeneratedColumn> get $columns => [
        id,
        code,
        nom,
        region,
        ville,
        powerConfig,
        statutGe,
        puissanceGeKva,
        latitude,
        longitude,
        cachedAt
      ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'cached_sites';
  @override
  VerificationContext validateIntegrity(Insertable<CachedSite> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('code')) {
      context.handle(
          _codeMeta, code.isAcceptableOrUnknown(data['code']!, _codeMeta));
    } else if (isInserting) {
      context.missing(_codeMeta);
    }
    if (data.containsKey('nom')) {
      context.handle(
          _nomMeta, nom.isAcceptableOrUnknown(data['nom']!, _nomMeta));
    } else if (isInserting) {
      context.missing(_nomMeta);
    }
    if (data.containsKey('region')) {
      context.handle(_regionMeta,
          region.isAcceptableOrUnknown(data['region']!, _regionMeta));
    } else if (isInserting) {
      context.missing(_regionMeta);
    }
    if (data.containsKey('ville')) {
      context.handle(
          _villeMeta, ville.isAcceptableOrUnknown(data['ville']!, _villeMeta));
    }
    if (data.containsKey('power_config')) {
      context.handle(
          _powerConfigMeta,
          powerConfig.isAcceptableOrUnknown(
              data['power_config']!, _powerConfigMeta));
    } else if (isInserting) {
      context.missing(_powerConfigMeta);
    }
    if (data.containsKey('statut_ge')) {
      context.handle(_statutGeMeta,
          statutGe.isAcceptableOrUnknown(data['statut_ge']!, _statutGeMeta));
    } else if (isInserting) {
      context.missing(_statutGeMeta);
    }
    if (data.containsKey('puissance_ge_kva')) {
      context.handle(
          _puissanceGeKvaMeta,
          puissanceGeKva.isAcceptableOrUnknown(
              data['puissance_ge_kva']!, _puissanceGeKvaMeta));
    }
    if (data.containsKey('latitude')) {
      context.handle(_latitudeMeta,
          latitude.isAcceptableOrUnknown(data['latitude']!, _latitudeMeta));
    }
    if (data.containsKey('longitude')) {
      context.handle(_longitudeMeta,
          longitude.isAcceptableOrUnknown(data['longitude']!, _longitudeMeta));
    }
    if (data.containsKey('cached_at')) {
      context.handle(_cachedAtMeta,
          cachedAt.isAcceptableOrUnknown(data['cached_at']!, _cachedAtMeta));
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  CachedSite map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return CachedSite(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}id'])!,
      code: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}code'])!,
      nom: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}nom'])!,
      region: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}region'])!,
      ville: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}ville']),
      powerConfig: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}power_config'])!,
      statutGe: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}statut_ge'])!,
      puissanceGeKva: attachedDatabase.typeMapping.read(
          DriftSqlType.double, data['${effectivePrefix}puissance_ge_kva'])!,
      latitude: attachedDatabase.typeMapping
          .read(DriftSqlType.double, data['${effectivePrefix}latitude']),
      longitude: attachedDatabase.typeMapping
          .read(DriftSqlType.double, data['${effectivePrefix}longitude']),
      cachedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}cached_at'])!,
    );
  }

  @override
  $CachedSitesTable createAlias(String alias) {
    return $CachedSitesTable(attachedDatabase, alias);
  }
}

class CachedSite extends DataClass implements Insertable<CachedSite> {
  final String id;
  final String code;
  final String nom;
  final String region;
  final String? ville;
  final String powerConfig;
  final String statutGe;
  final double puissanceGeKva;
  final double? latitude;
  final double? longitude;
  final DateTime cachedAt;
  const CachedSite(
      {required this.id,
      required this.code,
      required this.nom,
      required this.region,
      this.ville,
      required this.powerConfig,
      required this.statutGe,
      required this.puissanceGeKva,
      this.latitude,
      this.longitude,
      required this.cachedAt});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['code'] = Variable<String>(code);
    map['nom'] = Variable<String>(nom);
    map['region'] = Variable<String>(region);
    if (!nullToAbsent || ville != null) {
      map['ville'] = Variable<String>(ville);
    }
    map['power_config'] = Variable<String>(powerConfig);
    map['statut_ge'] = Variable<String>(statutGe);
    map['puissance_ge_kva'] = Variable<double>(puissanceGeKva);
    if (!nullToAbsent || latitude != null) {
      map['latitude'] = Variable<double>(latitude);
    }
    if (!nullToAbsent || longitude != null) {
      map['longitude'] = Variable<double>(longitude);
    }
    map['cached_at'] = Variable<DateTime>(cachedAt);
    return map;
  }

  CachedSitesCompanion toCompanion(bool nullToAbsent) {
    return CachedSitesCompanion(
      id: Value(id),
      code: Value(code),
      nom: Value(nom),
      region: Value(region),
      ville:
          ville == null && nullToAbsent ? const Value.absent() : Value(ville),
      powerConfig: Value(powerConfig),
      statutGe: Value(statutGe),
      puissanceGeKva: Value(puissanceGeKva),
      latitude: latitude == null && nullToAbsent
          ? const Value.absent()
          : Value(latitude),
      longitude: longitude == null && nullToAbsent
          ? const Value.absent()
          : Value(longitude),
      cachedAt: Value(cachedAt),
    );
  }

  factory CachedSite.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return CachedSite(
      id: serializer.fromJson<String>(json['id']),
      code: serializer.fromJson<String>(json['code']),
      nom: serializer.fromJson<String>(json['nom']),
      region: serializer.fromJson<String>(json['region']),
      ville: serializer.fromJson<String?>(json['ville']),
      powerConfig: serializer.fromJson<String>(json['powerConfig']),
      statutGe: serializer.fromJson<String>(json['statutGe']),
      puissanceGeKva: serializer.fromJson<double>(json['puissanceGeKva']),
      latitude: serializer.fromJson<double?>(json['latitude']),
      longitude: serializer.fromJson<double?>(json['longitude']),
      cachedAt: serializer.fromJson<DateTime>(json['cachedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'code': serializer.toJson<String>(code),
      'nom': serializer.toJson<String>(nom),
      'region': serializer.toJson<String>(region),
      'ville': serializer.toJson<String?>(ville),
      'powerConfig': serializer.toJson<String>(powerConfig),
      'statutGe': serializer.toJson<String>(statutGe),
      'puissanceGeKva': serializer.toJson<double>(puissanceGeKva),
      'latitude': serializer.toJson<double?>(latitude),
      'longitude': serializer.toJson<double?>(longitude),
      'cachedAt': serializer.toJson<DateTime>(cachedAt),
    };
  }

  CachedSite copyWith(
          {String? id,
          String? code,
          String? nom,
          String? region,
          Value<String?> ville = const Value.absent(),
          String? powerConfig,
          String? statutGe,
          double? puissanceGeKva,
          Value<double?> latitude = const Value.absent(),
          Value<double?> longitude = const Value.absent(),
          DateTime? cachedAt}) =>
      CachedSite(
        id: id ?? this.id,
        code: code ?? this.code,
        nom: nom ?? this.nom,
        region: region ?? this.region,
        ville: ville.present ? ville.value : this.ville,
        powerConfig: powerConfig ?? this.powerConfig,
        statutGe: statutGe ?? this.statutGe,
        puissanceGeKva: puissanceGeKva ?? this.puissanceGeKva,
        latitude: latitude.present ? latitude.value : this.latitude,
        longitude: longitude.present ? longitude.value : this.longitude,
        cachedAt: cachedAt ?? this.cachedAt,
      );
  CachedSite copyWithCompanion(CachedSitesCompanion data) {
    return CachedSite(
      id: data.id.present ? data.id.value : this.id,
      code: data.code.present ? data.code.value : this.code,
      nom: data.nom.present ? data.nom.value : this.nom,
      region: data.region.present ? data.region.value : this.region,
      ville: data.ville.present ? data.ville.value : this.ville,
      powerConfig:
          data.powerConfig.present ? data.powerConfig.value : this.powerConfig,
      statutGe: data.statutGe.present ? data.statutGe.value : this.statutGe,
      puissanceGeKva: data.puissanceGeKva.present
          ? data.puissanceGeKva.value
          : this.puissanceGeKva,
      latitude: data.latitude.present ? data.latitude.value : this.latitude,
      longitude: data.longitude.present ? data.longitude.value : this.longitude,
      cachedAt: data.cachedAt.present ? data.cachedAt.value : this.cachedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('CachedSite(')
          ..write('id: $id, ')
          ..write('code: $code, ')
          ..write('nom: $nom, ')
          ..write('region: $region, ')
          ..write('ville: $ville, ')
          ..write('powerConfig: $powerConfig, ')
          ..write('statutGe: $statutGe, ')
          ..write('puissanceGeKva: $puissanceGeKva, ')
          ..write('latitude: $latitude, ')
          ..write('longitude: $longitude, ')
          ..write('cachedAt: $cachedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(id, code, nom, region, ville, powerConfig,
      statutGe, puissanceGeKva, latitude, longitude, cachedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is CachedSite &&
          other.id == this.id &&
          other.code == this.code &&
          other.nom == this.nom &&
          other.region == this.region &&
          other.ville == this.ville &&
          other.powerConfig == this.powerConfig &&
          other.statutGe == this.statutGe &&
          other.puissanceGeKva == this.puissanceGeKva &&
          other.latitude == this.latitude &&
          other.longitude == this.longitude &&
          other.cachedAt == this.cachedAt);
}

class CachedSitesCompanion extends UpdateCompanion<CachedSite> {
  final Value<String> id;
  final Value<String> code;
  final Value<String> nom;
  final Value<String> region;
  final Value<String?> ville;
  final Value<String> powerConfig;
  final Value<String> statutGe;
  final Value<double> puissanceGeKva;
  final Value<double?> latitude;
  final Value<double?> longitude;
  final Value<DateTime> cachedAt;
  final Value<int> rowid;
  const CachedSitesCompanion({
    this.id = const Value.absent(),
    this.code = const Value.absent(),
    this.nom = const Value.absent(),
    this.region = const Value.absent(),
    this.ville = const Value.absent(),
    this.powerConfig = const Value.absent(),
    this.statutGe = const Value.absent(),
    this.puissanceGeKva = const Value.absent(),
    this.latitude = const Value.absent(),
    this.longitude = const Value.absent(),
    this.cachedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  CachedSitesCompanion.insert({
    required String id,
    required String code,
    required String nom,
    required String region,
    this.ville = const Value.absent(),
    required String powerConfig,
    required String statutGe,
    this.puissanceGeKva = const Value.absent(),
    this.latitude = const Value.absent(),
    this.longitude = const Value.absent(),
    this.cachedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  })  : id = Value(id),
        code = Value(code),
        nom = Value(nom),
        region = Value(region),
        powerConfig = Value(powerConfig),
        statutGe = Value(statutGe);
  static Insertable<CachedSite> custom({
    Expression<String>? id,
    Expression<String>? code,
    Expression<String>? nom,
    Expression<String>? region,
    Expression<String>? ville,
    Expression<String>? powerConfig,
    Expression<String>? statutGe,
    Expression<double>? puissanceGeKva,
    Expression<double>? latitude,
    Expression<double>? longitude,
    Expression<DateTime>? cachedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (code != null) 'code': code,
      if (nom != null) 'nom': nom,
      if (region != null) 'region': region,
      if (ville != null) 'ville': ville,
      if (powerConfig != null) 'power_config': powerConfig,
      if (statutGe != null) 'statut_ge': statutGe,
      if (puissanceGeKva != null) 'puissance_ge_kva': puissanceGeKva,
      if (latitude != null) 'latitude': latitude,
      if (longitude != null) 'longitude': longitude,
      if (cachedAt != null) 'cached_at': cachedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  CachedSitesCompanion copyWith(
      {Value<String>? id,
      Value<String>? code,
      Value<String>? nom,
      Value<String>? region,
      Value<String?>? ville,
      Value<String>? powerConfig,
      Value<String>? statutGe,
      Value<double>? puissanceGeKva,
      Value<double?>? latitude,
      Value<double?>? longitude,
      Value<DateTime>? cachedAt,
      Value<int>? rowid}) {
    return CachedSitesCompanion(
      id: id ?? this.id,
      code: code ?? this.code,
      nom: nom ?? this.nom,
      region: region ?? this.region,
      ville: ville ?? this.ville,
      powerConfig: powerConfig ?? this.powerConfig,
      statutGe: statutGe ?? this.statutGe,
      puissanceGeKva: puissanceGeKva ?? this.puissanceGeKva,
      latitude: latitude ?? this.latitude,
      longitude: longitude ?? this.longitude,
      cachedAt: cachedAt ?? this.cachedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (code.present) {
      map['code'] = Variable<String>(code.value);
    }
    if (nom.present) {
      map['nom'] = Variable<String>(nom.value);
    }
    if (region.present) {
      map['region'] = Variable<String>(region.value);
    }
    if (ville.present) {
      map['ville'] = Variable<String>(ville.value);
    }
    if (powerConfig.present) {
      map['power_config'] = Variable<String>(powerConfig.value);
    }
    if (statutGe.present) {
      map['statut_ge'] = Variable<String>(statutGe.value);
    }
    if (puissanceGeKva.present) {
      map['puissance_ge_kva'] = Variable<double>(puissanceGeKva.value);
    }
    if (latitude.present) {
      map['latitude'] = Variable<double>(latitude.value);
    }
    if (longitude.present) {
      map['longitude'] = Variable<double>(longitude.value);
    }
    if (cachedAt.present) {
      map['cached_at'] = Variable<DateTime>(cachedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('CachedSitesCompanion(')
          ..write('id: $id, ')
          ..write('code: $code, ')
          ..write('nom: $nom, ')
          ..write('region: $region, ')
          ..write('ville: $ville, ')
          ..write('powerConfig: $powerConfig, ')
          ..write('statutGe: $statutGe, ')
          ..write('puissanceGeKva: $puissanceGeKva, ')
          ..write('latitude: $latitude, ')
          ..write('longitude: $longitude, ')
          ..write('cachedAt: $cachedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $OutboxEntriesTable extends OutboxEntries
    with TableInfo<$OutboxEntriesTable, OutboxEntry> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $OutboxEntriesTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _localIdMeta =
      const VerificationMeta('localId');
  @override
  late final GeneratedColumn<int> localId = GeneratedColumn<int>(
      'local_id', aliasedName, false,
      hasAutoIncrement: true,
      type: DriftSqlType.int,
      requiredDuringInsert: false,
      defaultConstraints:
          GeneratedColumn.constraintIsAlways('PRIMARY KEY AUTOINCREMENT'));
  static const VerificationMeta _endpointMeta =
      const VerificationMeta('endpoint');
  @override
  late final GeneratedColumn<String> endpoint = GeneratedColumn<String>(
      'endpoint', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _methodMeta = const VerificationMeta('method');
  @override
  late final GeneratedColumn<String> method = GeneratedColumn<String>(
      'method', aliasedName, false,
      type: DriftSqlType.string,
      requiredDuringInsert: false,
      defaultValue: const Constant('POST'));
  static const VerificationMeta _payloadMeta =
      const VerificationMeta('payload');
  @override
  late final GeneratedColumn<String> payload = GeneratedColumn<String>(
      'payload', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _entityTypeMeta =
      const VerificationMeta('entityType');
  @override
  late final GeneratedColumn<String> entityType = GeneratedColumn<String>(
      'entity_type', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _clientUuidMeta =
      const VerificationMeta('clientUuid');
  @override
  late final GeneratedColumn<String> clientUuid = GeneratedColumn<String>(
      'client_uuid', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _retriesMeta =
      const VerificationMeta('retries');
  @override
  late final GeneratedColumn<int> retries = GeneratedColumn<int>(
      'retries', aliasedName, false,
      type: DriftSqlType.int,
      requiredDuringInsert: false,
      defaultValue: const Constant(0));
  static const VerificationMeta _lastErrorMeta =
      const VerificationMeta('lastError');
  @override
  late final GeneratedColumn<String> lastError = GeneratedColumn<String>(
      'last_error', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _createdAtMeta =
      const VerificationMeta('createdAt');
  @override
  late final GeneratedColumn<DateTime> createdAt = GeneratedColumn<DateTime>(
      'created_at', aliasedName, false,
      type: DriftSqlType.dateTime,
      requiredDuringInsert: false,
      defaultValue: currentDateAndTime);
  @override
  List<GeneratedColumn> get $columns => [
        localId,
        endpoint,
        method,
        payload,
        entityType,
        clientUuid,
        retries,
        lastError,
        createdAt
      ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'outbox_entries';
  @override
  VerificationContext validateIntegrity(Insertable<OutboxEntry> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('local_id')) {
      context.handle(_localIdMeta,
          localId.isAcceptableOrUnknown(data['local_id']!, _localIdMeta));
    }
    if (data.containsKey('endpoint')) {
      context.handle(_endpointMeta,
          endpoint.isAcceptableOrUnknown(data['endpoint']!, _endpointMeta));
    } else if (isInserting) {
      context.missing(_endpointMeta);
    }
    if (data.containsKey('method')) {
      context.handle(_methodMeta,
          method.isAcceptableOrUnknown(data['method']!, _methodMeta));
    }
    if (data.containsKey('payload')) {
      context.handle(_payloadMeta,
          payload.isAcceptableOrUnknown(data['payload']!, _payloadMeta));
    } else if (isInserting) {
      context.missing(_payloadMeta);
    }
    if (data.containsKey('entity_type')) {
      context.handle(
          _entityTypeMeta,
          entityType.isAcceptableOrUnknown(
              data['entity_type']!, _entityTypeMeta));
    } else if (isInserting) {
      context.missing(_entityTypeMeta);
    }
    if (data.containsKey('client_uuid')) {
      context.handle(
          _clientUuidMeta,
          clientUuid.isAcceptableOrUnknown(
              data['client_uuid']!, _clientUuidMeta));
    } else if (isInserting) {
      context.missing(_clientUuidMeta);
    }
    if (data.containsKey('retries')) {
      context.handle(_retriesMeta,
          retries.isAcceptableOrUnknown(data['retries']!, _retriesMeta));
    }
    if (data.containsKey('last_error')) {
      context.handle(_lastErrorMeta,
          lastError.isAcceptableOrUnknown(data['last_error']!, _lastErrorMeta));
    }
    if (data.containsKey('created_at')) {
      context.handle(_createdAtMeta,
          createdAt.isAcceptableOrUnknown(data['created_at']!, _createdAtMeta));
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {localId};
  @override
  OutboxEntry map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return OutboxEntry(
      localId: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}local_id'])!,
      endpoint: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}endpoint'])!,
      method: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}method'])!,
      payload: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}payload'])!,
      entityType: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}entity_type'])!,
      clientUuid: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}client_uuid'])!,
      retries: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}retries'])!,
      lastError: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}last_error']),
      createdAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}created_at'])!,
    );
  }

  @override
  $OutboxEntriesTable createAlias(String alias) {
    return $OutboxEntriesTable(attachedDatabase, alias);
  }
}

class OutboxEntry extends DataClass implements Insertable<OutboxEntry> {
  final int localId;
  final String endpoint;
  final String method;
  final String payload;
  final String entityType;
  final String clientUuid;
  final int retries;
  final String? lastError;
  final DateTime createdAt;
  const OutboxEntry(
      {required this.localId,
      required this.endpoint,
      required this.method,
      required this.payload,
      required this.entityType,
      required this.clientUuid,
      required this.retries,
      this.lastError,
      required this.createdAt});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['local_id'] = Variable<int>(localId);
    map['endpoint'] = Variable<String>(endpoint);
    map['method'] = Variable<String>(method);
    map['payload'] = Variable<String>(payload);
    map['entity_type'] = Variable<String>(entityType);
    map['client_uuid'] = Variable<String>(clientUuid);
    map['retries'] = Variable<int>(retries);
    if (!nullToAbsent || lastError != null) {
      map['last_error'] = Variable<String>(lastError);
    }
    map['created_at'] = Variable<DateTime>(createdAt);
    return map;
  }

  OutboxEntriesCompanion toCompanion(bool nullToAbsent) {
    return OutboxEntriesCompanion(
      localId: Value(localId),
      endpoint: Value(endpoint),
      method: Value(method),
      payload: Value(payload),
      entityType: Value(entityType),
      clientUuid: Value(clientUuid),
      retries: Value(retries),
      lastError: lastError == null && nullToAbsent
          ? const Value.absent()
          : Value(lastError),
      createdAt: Value(createdAt),
    );
  }

  factory OutboxEntry.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return OutboxEntry(
      localId: serializer.fromJson<int>(json['localId']),
      endpoint: serializer.fromJson<String>(json['endpoint']),
      method: serializer.fromJson<String>(json['method']),
      payload: serializer.fromJson<String>(json['payload']),
      entityType: serializer.fromJson<String>(json['entityType']),
      clientUuid: serializer.fromJson<String>(json['clientUuid']),
      retries: serializer.fromJson<int>(json['retries']),
      lastError: serializer.fromJson<String?>(json['lastError']),
      createdAt: serializer.fromJson<DateTime>(json['createdAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'localId': serializer.toJson<int>(localId),
      'endpoint': serializer.toJson<String>(endpoint),
      'method': serializer.toJson<String>(method),
      'payload': serializer.toJson<String>(payload),
      'entityType': serializer.toJson<String>(entityType),
      'clientUuid': serializer.toJson<String>(clientUuid),
      'retries': serializer.toJson<int>(retries),
      'lastError': serializer.toJson<String?>(lastError),
      'createdAt': serializer.toJson<DateTime>(createdAt),
    };
  }

  OutboxEntry copyWith(
          {int? localId,
          String? endpoint,
          String? method,
          String? payload,
          String? entityType,
          String? clientUuid,
          int? retries,
          Value<String?> lastError = const Value.absent(),
          DateTime? createdAt}) =>
      OutboxEntry(
        localId: localId ?? this.localId,
        endpoint: endpoint ?? this.endpoint,
        method: method ?? this.method,
        payload: payload ?? this.payload,
        entityType: entityType ?? this.entityType,
        clientUuid: clientUuid ?? this.clientUuid,
        retries: retries ?? this.retries,
        lastError: lastError.present ? lastError.value : this.lastError,
        createdAt: createdAt ?? this.createdAt,
      );
  OutboxEntry copyWithCompanion(OutboxEntriesCompanion data) {
    return OutboxEntry(
      localId: data.localId.present ? data.localId.value : this.localId,
      endpoint: data.endpoint.present ? data.endpoint.value : this.endpoint,
      method: data.method.present ? data.method.value : this.method,
      payload: data.payload.present ? data.payload.value : this.payload,
      entityType:
          data.entityType.present ? data.entityType.value : this.entityType,
      clientUuid:
          data.clientUuid.present ? data.clientUuid.value : this.clientUuid,
      retries: data.retries.present ? data.retries.value : this.retries,
      lastError: data.lastError.present ? data.lastError.value : this.lastError,
      createdAt: data.createdAt.present ? data.createdAt.value : this.createdAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('OutboxEntry(')
          ..write('localId: $localId, ')
          ..write('endpoint: $endpoint, ')
          ..write('method: $method, ')
          ..write('payload: $payload, ')
          ..write('entityType: $entityType, ')
          ..write('clientUuid: $clientUuid, ')
          ..write('retries: $retries, ')
          ..write('lastError: $lastError, ')
          ..write('createdAt: $createdAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(localId, endpoint, method, payload,
      entityType, clientUuid, retries, lastError, createdAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is OutboxEntry &&
          other.localId == this.localId &&
          other.endpoint == this.endpoint &&
          other.method == this.method &&
          other.payload == this.payload &&
          other.entityType == this.entityType &&
          other.clientUuid == this.clientUuid &&
          other.retries == this.retries &&
          other.lastError == this.lastError &&
          other.createdAt == this.createdAt);
}

class OutboxEntriesCompanion extends UpdateCompanion<OutboxEntry> {
  final Value<int> localId;
  final Value<String> endpoint;
  final Value<String> method;
  final Value<String> payload;
  final Value<String> entityType;
  final Value<String> clientUuid;
  final Value<int> retries;
  final Value<String?> lastError;
  final Value<DateTime> createdAt;
  const OutboxEntriesCompanion({
    this.localId = const Value.absent(),
    this.endpoint = const Value.absent(),
    this.method = const Value.absent(),
    this.payload = const Value.absent(),
    this.entityType = const Value.absent(),
    this.clientUuid = const Value.absent(),
    this.retries = const Value.absent(),
    this.lastError = const Value.absent(),
    this.createdAt = const Value.absent(),
  });
  OutboxEntriesCompanion.insert({
    this.localId = const Value.absent(),
    required String endpoint,
    this.method = const Value.absent(),
    required String payload,
    required String entityType,
    required String clientUuid,
    this.retries = const Value.absent(),
    this.lastError = const Value.absent(),
    this.createdAt = const Value.absent(),
  })  : endpoint = Value(endpoint),
        payload = Value(payload),
        entityType = Value(entityType),
        clientUuid = Value(clientUuid);
  static Insertable<OutboxEntry> custom({
    Expression<int>? localId,
    Expression<String>? endpoint,
    Expression<String>? method,
    Expression<String>? payload,
    Expression<String>? entityType,
    Expression<String>? clientUuid,
    Expression<int>? retries,
    Expression<String>? lastError,
    Expression<DateTime>? createdAt,
  }) {
    return RawValuesInsertable({
      if (localId != null) 'local_id': localId,
      if (endpoint != null) 'endpoint': endpoint,
      if (method != null) 'method': method,
      if (payload != null) 'payload': payload,
      if (entityType != null) 'entity_type': entityType,
      if (clientUuid != null) 'client_uuid': clientUuid,
      if (retries != null) 'retries': retries,
      if (lastError != null) 'last_error': lastError,
      if (createdAt != null) 'created_at': createdAt,
    });
  }

  OutboxEntriesCompanion copyWith(
      {Value<int>? localId,
      Value<String>? endpoint,
      Value<String>? method,
      Value<String>? payload,
      Value<String>? entityType,
      Value<String>? clientUuid,
      Value<int>? retries,
      Value<String?>? lastError,
      Value<DateTime>? createdAt}) {
    return OutboxEntriesCompanion(
      localId: localId ?? this.localId,
      endpoint: endpoint ?? this.endpoint,
      method: method ?? this.method,
      payload: payload ?? this.payload,
      entityType: entityType ?? this.entityType,
      clientUuid: clientUuid ?? this.clientUuid,
      retries: retries ?? this.retries,
      lastError: lastError ?? this.lastError,
      createdAt: createdAt ?? this.createdAt,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (localId.present) {
      map['local_id'] = Variable<int>(localId.value);
    }
    if (endpoint.present) {
      map['endpoint'] = Variable<String>(endpoint.value);
    }
    if (method.present) {
      map['method'] = Variable<String>(method.value);
    }
    if (payload.present) {
      map['payload'] = Variable<String>(payload.value);
    }
    if (entityType.present) {
      map['entity_type'] = Variable<String>(entityType.value);
    }
    if (clientUuid.present) {
      map['client_uuid'] = Variable<String>(clientUuid.value);
    }
    if (retries.present) {
      map['retries'] = Variable<int>(retries.value);
    }
    if (lastError.present) {
      map['last_error'] = Variable<String>(lastError.value);
    }
    if (createdAt.present) {
      map['created_at'] = Variable<DateTime>(createdAt.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('OutboxEntriesCompanion(')
          ..write('localId: $localId, ')
          ..write('endpoint: $endpoint, ')
          ..write('method: $method, ')
          ..write('payload: $payload, ')
          ..write('entityType: $entityType, ')
          ..write('clientUuid: $clientUuid, ')
          ..write('retries: $retries, ')
          ..write('lastError: $lastError, ')
          ..write('createdAt: $createdAt')
          ..write(')'))
        .toString();
  }
}

abstract class _$AppDatabase extends GeneratedDatabase {
  _$AppDatabase(QueryExecutor e) : super(e);
  $AppDatabaseManager get managers => $AppDatabaseManager(this);
  late final $CachedSitesTable cachedSites = $CachedSitesTable(this);
  late final $OutboxEntriesTable outboxEntries = $OutboxEntriesTable(this);
  @override
  Iterable<TableInfo<Table, Object?>> get allTables =>
      allSchemaEntities.whereType<TableInfo<Table, Object?>>();
  @override
  List<DatabaseSchemaEntity> get allSchemaEntities =>
      [cachedSites, outboxEntries];
}

typedef $$CachedSitesTableCreateCompanionBuilder = CachedSitesCompanion
    Function({
  required String id,
  required String code,
  required String nom,
  required String region,
  Value<String?> ville,
  required String powerConfig,
  required String statutGe,
  Value<double> puissanceGeKva,
  Value<double?> latitude,
  Value<double?> longitude,
  Value<DateTime> cachedAt,
  Value<int> rowid,
});
typedef $$CachedSitesTableUpdateCompanionBuilder = CachedSitesCompanion
    Function({
  Value<String> id,
  Value<String> code,
  Value<String> nom,
  Value<String> region,
  Value<String?> ville,
  Value<String> powerConfig,
  Value<String> statutGe,
  Value<double> puissanceGeKva,
  Value<double?> latitude,
  Value<double?> longitude,
  Value<DateTime> cachedAt,
  Value<int> rowid,
});

class $$CachedSitesTableFilterComposer
    extends Composer<_$AppDatabase, $CachedSitesTable> {
  $$CachedSitesTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get code => $composableBuilder(
      column: $table.code, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get nom => $composableBuilder(
      column: $table.nom, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get region => $composableBuilder(
      column: $table.region, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get ville => $composableBuilder(
      column: $table.ville, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get powerConfig => $composableBuilder(
      column: $table.powerConfig, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get statutGe => $composableBuilder(
      column: $table.statutGe, builder: (column) => ColumnFilters(column));

  ColumnFilters<double> get puissanceGeKva => $composableBuilder(
      column: $table.puissanceGeKva,
      builder: (column) => ColumnFilters(column));

  ColumnFilters<double> get latitude => $composableBuilder(
      column: $table.latitude, builder: (column) => ColumnFilters(column));

  ColumnFilters<double> get longitude => $composableBuilder(
      column: $table.longitude, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get cachedAt => $composableBuilder(
      column: $table.cachedAt, builder: (column) => ColumnFilters(column));
}

class $$CachedSitesTableOrderingComposer
    extends Composer<_$AppDatabase, $CachedSitesTable> {
  $$CachedSitesTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get code => $composableBuilder(
      column: $table.code, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get nom => $composableBuilder(
      column: $table.nom, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get region => $composableBuilder(
      column: $table.region, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get ville => $composableBuilder(
      column: $table.ville, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get powerConfig => $composableBuilder(
      column: $table.powerConfig, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get statutGe => $composableBuilder(
      column: $table.statutGe, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<double> get puissanceGeKva => $composableBuilder(
      column: $table.puissanceGeKva,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<double> get latitude => $composableBuilder(
      column: $table.latitude, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<double> get longitude => $composableBuilder(
      column: $table.longitude, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get cachedAt => $composableBuilder(
      column: $table.cachedAt, builder: (column) => ColumnOrderings(column));
}

class $$CachedSitesTableAnnotationComposer
    extends Composer<_$AppDatabase, $CachedSitesTable> {
  $$CachedSitesTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get code =>
      $composableBuilder(column: $table.code, builder: (column) => column);

  GeneratedColumn<String> get nom =>
      $composableBuilder(column: $table.nom, builder: (column) => column);

  GeneratedColumn<String> get region =>
      $composableBuilder(column: $table.region, builder: (column) => column);

  GeneratedColumn<String> get ville =>
      $composableBuilder(column: $table.ville, builder: (column) => column);

  GeneratedColumn<String> get powerConfig => $composableBuilder(
      column: $table.powerConfig, builder: (column) => column);

  GeneratedColumn<String> get statutGe =>
      $composableBuilder(column: $table.statutGe, builder: (column) => column);

  GeneratedColumn<double> get puissanceGeKva => $composableBuilder(
      column: $table.puissanceGeKva, builder: (column) => column);

  GeneratedColumn<double> get latitude =>
      $composableBuilder(column: $table.latitude, builder: (column) => column);

  GeneratedColumn<double> get longitude =>
      $composableBuilder(column: $table.longitude, builder: (column) => column);

  GeneratedColumn<DateTime> get cachedAt =>
      $composableBuilder(column: $table.cachedAt, builder: (column) => column);
}

class $$CachedSitesTableTableManager extends RootTableManager<
    _$AppDatabase,
    $CachedSitesTable,
    CachedSite,
    $$CachedSitesTableFilterComposer,
    $$CachedSitesTableOrderingComposer,
    $$CachedSitesTableAnnotationComposer,
    $$CachedSitesTableCreateCompanionBuilder,
    $$CachedSitesTableUpdateCompanionBuilder,
    (CachedSite, BaseReferences<_$AppDatabase, $CachedSitesTable, CachedSite>),
    CachedSite,
    PrefetchHooks Function()> {
  $$CachedSitesTableTableManager(_$AppDatabase db, $CachedSitesTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$CachedSitesTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$CachedSitesTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$CachedSitesTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> id = const Value.absent(),
            Value<String> code = const Value.absent(),
            Value<String> nom = const Value.absent(),
            Value<String> region = const Value.absent(),
            Value<String?> ville = const Value.absent(),
            Value<String> powerConfig = const Value.absent(),
            Value<String> statutGe = const Value.absent(),
            Value<double> puissanceGeKva = const Value.absent(),
            Value<double?> latitude = const Value.absent(),
            Value<double?> longitude = const Value.absent(),
            Value<DateTime> cachedAt = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              CachedSitesCompanion(
            id: id,
            code: code,
            nom: nom,
            region: region,
            ville: ville,
            powerConfig: powerConfig,
            statutGe: statutGe,
            puissanceGeKva: puissanceGeKva,
            latitude: latitude,
            longitude: longitude,
            cachedAt: cachedAt,
            rowid: rowid,
          ),
          createCompanionCallback: ({
            required String id,
            required String code,
            required String nom,
            required String region,
            Value<String?> ville = const Value.absent(),
            required String powerConfig,
            required String statutGe,
            Value<double> puissanceGeKva = const Value.absent(),
            Value<double?> latitude = const Value.absent(),
            Value<double?> longitude = const Value.absent(),
            Value<DateTime> cachedAt = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              CachedSitesCompanion.insert(
            id: id,
            code: code,
            nom: nom,
            region: region,
            ville: ville,
            powerConfig: powerConfig,
            statutGe: statutGe,
            puissanceGeKva: puissanceGeKva,
            latitude: latitude,
            longitude: longitude,
            cachedAt: cachedAt,
            rowid: rowid,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$CachedSitesTableProcessedTableManager = ProcessedTableManager<
    _$AppDatabase,
    $CachedSitesTable,
    CachedSite,
    $$CachedSitesTableFilterComposer,
    $$CachedSitesTableOrderingComposer,
    $$CachedSitesTableAnnotationComposer,
    $$CachedSitesTableCreateCompanionBuilder,
    $$CachedSitesTableUpdateCompanionBuilder,
    (CachedSite, BaseReferences<_$AppDatabase, $CachedSitesTable, CachedSite>),
    CachedSite,
    PrefetchHooks Function()>;
typedef $$OutboxEntriesTableCreateCompanionBuilder = OutboxEntriesCompanion
    Function({
  Value<int> localId,
  required String endpoint,
  Value<String> method,
  required String payload,
  required String entityType,
  required String clientUuid,
  Value<int> retries,
  Value<String?> lastError,
  Value<DateTime> createdAt,
});
typedef $$OutboxEntriesTableUpdateCompanionBuilder = OutboxEntriesCompanion
    Function({
  Value<int> localId,
  Value<String> endpoint,
  Value<String> method,
  Value<String> payload,
  Value<String> entityType,
  Value<String> clientUuid,
  Value<int> retries,
  Value<String?> lastError,
  Value<DateTime> createdAt,
});

class $$OutboxEntriesTableFilterComposer
    extends Composer<_$AppDatabase, $OutboxEntriesTable> {
  $$OutboxEntriesTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get localId => $composableBuilder(
      column: $table.localId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get endpoint => $composableBuilder(
      column: $table.endpoint, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get method => $composableBuilder(
      column: $table.method, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get payload => $composableBuilder(
      column: $table.payload, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get entityType => $composableBuilder(
      column: $table.entityType, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get clientUuid => $composableBuilder(
      column: $table.clientUuid, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get retries => $composableBuilder(
      column: $table.retries, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get lastError => $composableBuilder(
      column: $table.lastError, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get createdAt => $composableBuilder(
      column: $table.createdAt, builder: (column) => ColumnFilters(column));
}

class $$OutboxEntriesTableOrderingComposer
    extends Composer<_$AppDatabase, $OutboxEntriesTable> {
  $$OutboxEntriesTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get localId => $composableBuilder(
      column: $table.localId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get endpoint => $composableBuilder(
      column: $table.endpoint, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get method => $composableBuilder(
      column: $table.method, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get payload => $composableBuilder(
      column: $table.payload, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get entityType => $composableBuilder(
      column: $table.entityType, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get clientUuid => $composableBuilder(
      column: $table.clientUuid, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get retries => $composableBuilder(
      column: $table.retries, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get lastError => $composableBuilder(
      column: $table.lastError, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get createdAt => $composableBuilder(
      column: $table.createdAt, builder: (column) => ColumnOrderings(column));
}

class $$OutboxEntriesTableAnnotationComposer
    extends Composer<_$AppDatabase, $OutboxEntriesTable> {
  $$OutboxEntriesTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get localId =>
      $composableBuilder(column: $table.localId, builder: (column) => column);

  GeneratedColumn<String> get endpoint =>
      $composableBuilder(column: $table.endpoint, builder: (column) => column);

  GeneratedColumn<String> get method =>
      $composableBuilder(column: $table.method, builder: (column) => column);

  GeneratedColumn<String> get payload =>
      $composableBuilder(column: $table.payload, builder: (column) => column);

  GeneratedColumn<String> get entityType => $composableBuilder(
      column: $table.entityType, builder: (column) => column);

  GeneratedColumn<String> get clientUuid => $composableBuilder(
      column: $table.clientUuid, builder: (column) => column);

  GeneratedColumn<int> get retries =>
      $composableBuilder(column: $table.retries, builder: (column) => column);

  GeneratedColumn<String> get lastError =>
      $composableBuilder(column: $table.lastError, builder: (column) => column);

  GeneratedColumn<DateTime> get createdAt =>
      $composableBuilder(column: $table.createdAt, builder: (column) => column);
}

class $$OutboxEntriesTableTableManager extends RootTableManager<
    _$AppDatabase,
    $OutboxEntriesTable,
    OutboxEntry,
    $$OutboxEntriesTableFilterComposer,
    $$OutboxEntriesTableOrderingComposer,
    $$OutboxEntriesTableAnnotationComposer,
    $$OutboxEntriesTableCreateCompanionBuilder,
    $$OutboxEntriesTableUpdateCompanionBuilder,
    (
      OutboxEntry,
      BaseReferences<_$AppDatabase, $OutboxEntriesTable, OutboxEntry>
    ),
    OutboxEntry,
    PrefetchHooks Function()> {
  $$OutboxEntriesTableTableManager(_$AppDatabase db, $OutboxEntriesTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$OutboxEntriesTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$OutboxEntriesTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$OutboxEntriesTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<int> localId = const Value.absent(),
            Value<String> endpoint = const Value.absent(),
            Value<String> method = const Value.absent(),
            Value<String> payload = const Value.absent(),
            Value<String> entityType = const Value.absent(),
            Value<String> clientUuid = const Value.absent(),
            Value<int> retries = const Value.absent(),
            Value<String?> lastError = const Value.absent(),
            Value<DateTime> createdAt = const Value.absent(),
          }) =>
              OutboxEntriesCompanion(
            localId: localId,
            endpoint: endpoint,
            method: method,
            payload: payload,
            entityType: entityType,
            clientUuid: clientUuid,
            retries: retries,
            lastError: lastError,
            createdAt: createdAt,
          ),
          createCompanionCallback: ({
            Value<int> localId = const Value.absent(),
            required String endpoint,
            Value<String> method = const Value.absent(),
            required String payload,
            required String entityType,
            required String clientUuid,
            Value<int> retries = const Value.absent(),
            Value<String?> lastError = const Value.absent(),
            Value<DateTime> createdAt = const Value.absent(),
          }) =>
              OutboxEntriesCompanion.insert(
            localId: localId,
            endpoint: endpoint,
            method: method,
            payload: payload,
            entityType: entityType,
            clientUuid: clientUuid,
            retries: retries,
            lastError: lastError,
            createdAt: createdAt,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$OutboxEntriesTableProcessedTableManager = ProcessedTableManager<
    _$AppDatabase,
    $OutboxEntriesTable,
    OutboxEntry,
    $$OutboxEntriesTableFilterComposer,
    $$OutboxEntriesTableOrderingComposer,
    $$OutboxEntriesTableAnnotationComposer,
    $$OutboxEntriesTableCreateCompanionBuilder,
    $$OutboxEntriesTableUpdateCompanionBuilder,
    (
      OutboxEntry,
      BaseReferences<_$AppDatabase, $OutboxEntriesTable, OutboxEntry>
    ),
    OutboxEntry,
    PrefetchHooks Function()>;

class $AppDatabaseManager {
  final _$AppDatabase _db;
  $AppDatabaseManager(this._db);
  $$CachedSitesTableTableManager get cachedSites =>
      $$CachedSitesTableTableManager(_db, _db.cachedSites);
  $$OutboxEntriesTableTableManager get outboxEntries =>
      $$OutboxEntriesTableTableManager(_db, _db.outboxEntries);
}
