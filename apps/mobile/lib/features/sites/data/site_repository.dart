import '../../../core/database/app_database.dart';
import '../../../core/network/dio_client.dart';
import '../../../core/network/network_info.dart';
import '../../../core/errors/exceptions.dart';
import 'site_model.dart';

/// Accès aux sites : API en ligne, cache Drift hors-ligne.
class SiteRepository {
  final DioClient _client;
  final AppDatabase _db;
  final NetworkInfo _network;

  SiteRepository(this._client, this._db, this._network);

  /// Liste des sites. En ligne : API + mise en cache. Hors-ligne : cache local.
  Future<List<Site>> getSites({String? search, String? region}) async {
    if (await _network.isConnected) {
      try {
        final sites = await _client.request(
          (dio) => dio.get('/sites', queryParameters: {
            'all': 'true', // tous les sites (sans plafond de pagination)
            if (search != null && search.isNotEmpty) 'search': search,
            if (region != null && region.isNotEmpty) 'region': region,
          }),
          (data) => (data['data'] as List).map((e) => Site.fromJson(e as Map<String, dynamic>)).toList(),
        );
        // Mise en cache (sans filtre on cache tout)
        if ((search == null || search.isEmpty) && (region == null || region.isEmpty)) {
          await _db.upsertSites(sites.map((s) => s.toCompanion()).toList());
        }
        return sites;
      } on NetworkException {
        return _fromCache(search: search, region: region);
      }
    }
    return _fromCache(search: search, region: region);
  }

  Future<List<Site>> _fromCache({String? search, String? region}) async {
    final cached = await _db.getCachedSites();
    var sites = cached.map(Site.fromCache).toList();
    if (search != null && search.isNotEmpty) {
      final q = search.toLowerCase();
      sites = sites.where((s) => s.nom.toLowerCase().contains(q) || s.region.toLowerCase().contains(q)).toList();
    }
    if (region != null && region.isNotEmpty) {
      sites = sites.where((s) => s.region == region).toList();
    }
    return sites;
  }

  /// Tâches préventives contractuelles applicables au site (en ligne uniquement).
  Future<List<TacheSite>> getTachesPreventives(String id) async {
    if (!await _network.isConnected) return [];
    try {
      return await _client.request(
        (dio) => dio.get('/sites/$id/taches-preventives'),
        (data) => (data['data'] as List).map((e) => TacheSite.fromJson(e as Map<String, dynamic>)).toList(),
      );
    } catch (_) {
      return [];
    }
  }

  Future<Site> getSite(String id) async {
    if (await _network.isConnected) {
      try {
        return await _client.request(
          (dio) => dio.get('/sites/$id'),
          (data) => Site.fromJson(data['data'] as Map<String, dynamic>),
        );
      } on NetworkException {
        // fallback cache
      }
    }
    final c = await _db.getCachedSite(id);
    if (c == null) throw const ServerException('Site indisponible hors-ligne');
    return Site.fromCache(c);
  }

  Future<SiteStock?> getStock(String id) async {
    if (!await _network.isConnected) return null;
    try {
      return await _client.request(
        (dio) => dio.get('/sites/$id/stock'),
        (data) => SiteStock.fromJson(data['data'] as Map<String, dynamic>),
      );
    } catch (_) {
      return null;
    }
  }
}
