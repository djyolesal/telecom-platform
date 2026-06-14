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
}
