import '../../../core/database/app_database.dart';
import 'package:drift/drift.dart';

/// Attribution de maintenance d'un lot (prestataire + périmètre).
class LotAttribution {
  final String scope; // PASSIVE / ACTIVE / LES_DEUX
  final String prestataireNom;
  final String? prestataireTel;
  const LotAttribution({required this.scope, required this.prestataireNom, this.prestataireTel});

  factory LotAttribution.fromJson(Map<String, dynamic> j) {
    final p = j['prestataire'] as Map<String, dynamic>?;
    return LotAttribution(
      scope: j['scope'] as String? ?? '',
      prestataireNom: p?['nom'] as String? ?? '—',
      prestataireTel: p?['telephone'] as String?,
    );
  }
}

/// Site BTS / antenne.
class Site {
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
  // Rempli uniquement par la fiche détail (getSiteById include lot/attributions)
  final String? lotCode;
  final String? lotNom;
  final List<LotAttribution> attributions;

  const Site({
    required this.id,
    required this.code,
    required this.nom,
    required this.region,
    this.ville,
    required this.powerConfig,
    required this.statutGe,
    required this.puissanceGeKva,
    this.latitude,
    this.longitude,
    this.lotCode,
    this.lotNom,
    this.attributions = const [],
  });

  static double _toD(dynamic v) => v == null ? 0 : (v is num ? v.toDouble() : double.tryParse(v.toString()) ?? 0);
  static double? _toDn(dynamic v) => v == null ? null : (v is num ? v.toDouble() : double.tryParse(v.toString()));

  factory Site.fromJson(Map<String, dynamic> j) {
    final lot = j['lot'] as Map<String, dynamic>?;
    final assignments = (lot?['assignments'] as List?) ?? [];
    return Site(
      id: j['id'] as String,
      code: j['code'] as String,
      nom: j['nom'] as String,
      region: j['region'] as String,
      ville: j['ville'] as String?,
      powerConfig: j['powerConfig'] as String,
      statutGe: j['statutGE'] as String,
      puissanceGeKva: _toD(j['puissanceGEkva']),
      latitude: _toDn(j['latitude']),
      longitude: _toDn(j['longitude']),
      lotCode: lot?['code'] as String?,
      lotNom: lot?['nom'] as String?,
      attributions: assignments.map((a) => LotAttribution.fromJson(a as Map<String, dynamic>)).toList(),
    );
  }

  factory Site.fromCache(CachedSite c) => Site(
        id: c.id,
        code: c.code,
        nom: c.nom,
        region: c.region,
        ville: c.ville,
        powerConfig: c.powerConfig,
        statutGe: c.statutGe,
        puissanceGeKva: c.puissanceGeKva,
        latitude: c.latitude,
        longitude: c.longitude,
      );

  CachedSitesCompanion toCompanion() => CachedSitesCompanion.insert(
        id: id,
        code: code,
        nom: nom,
        region: region,
        ville: Value(ville),
        powerConfig: powerConfig,
        statutGe: statutGe,
        puissanceGeKva: Value(puissanceGeKva),
        latitude: Value(latitude),
        longitude: Value(longitude),
      );
}

/// Calcul de stock/autonomie retourné par /sites/:id/stock.
class SiteStock {
  final double stockLitres;
  final double litresMois;
  final double coutMoisFCFA;
  final double? autonomieJours;
  final String niveauAlerte;

  const SiteStock({
    required this.stockLitres,
    required this.litresMois,
    required this.coutMoisFCFA,
    this.autonomieJours,
    required this.niveauAlerte,
  });

  factory SiteStock.fromJson(Map<String, dynamic> j) => SiteStock(
        stockLitres: Site._toD(j['stockLitres']),
        litresMois: Site._toD(j['litresMois']),
        coutMoisFCFA: Site._toD(j['coutMoisFCFA']),
        autonomieJours: Site._toDn(j['autonomieJours']),
        niveauAlerte: j['niveauAlerte'] as String? ?? 'NA',
      );
}
