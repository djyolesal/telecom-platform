import '../../../core/network/dio_client.dart';
import '../../../core/network/network_info.dart';

class DashboardRepository {
  final DioClient _client;
  final NetworkInfo _network;
  DashboardRepository(this._client, this._network);

  /// Indicateurs du tableau de bord (null si hors-ligne).
  Future<Map<String, dynamic>?> getDashboard() async {
    if (!await _network.isConnected) return null;
    try {
      return await _client.request(
        (dio) => dio.get('/rapports/dashboard'),
        (data) => data['data'] as Map<String, dynamic>,
      );
    } catch (_) {
      return null;
    }
  }

  /// Ligne de vie : événements par heure sur 24 h + niveau d'agitation.
  /// null hors-ligne ou en erreur → le widget retombe sur le tracé décoratif.
  Future<({List<int> points, String agitation})?> getPouls() async {
    if (!await _network.isConnected) return null;
    try {
      return await _client.request(
        (dio) => dio.get('/rapports/pouls-24h'),
        (data) {
          final d = data['data'] as Map<String, dynamic>;
          final points = (d['points'] as List)
              .map((p) => ((p['incidents'] ?? 0) as num).toInt() + ((p['coupures'] ?? 0) as num).toInt())
              .toList();
          return (points: points, agitation: (d['agitation'] ?? 'CALME') as String);
        },
      );
    } catch (_) {
      return null;
    }
  }
}
