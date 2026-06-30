import '../network/dio_client.dart';

/// Règles terrain configurables côté serveur, récupérées via GET /config.
/// Valeurs par défaut sûres si le serveur n'a pas (encore) répondu.
class AppConfig {
  static int minDureeClotureMin = 60;
  static double geofenceRadiusM = 20;
  static int minPhotosPreventive = 6;
  static int minPhotosMouvement = 2;
}

/// Charge la configuration applicative depuis l'API et met à jour [AppConfig].
class ConfigService {
  final DioClient _client;
  ConfigService(this._client);

  Future<void> load() async {
    try {
      await _client.request<void>(
        (dio) => dio.get('/config'),
        (data) {
          final d = data is Map ? data['data'] as Map? : null;
          if (d != null) {
            AppConfig.minDureeClotureMin = (d['minDureeClotureMin'] as num?)?.toInt() ?? AppConfig.minDureeClotureMin;
            AppConfig.geofenceRadiusM = (d['geofenceRadiusM'] as num?)?.toDouble() ?? AppConfig.geofenceRadiusM;
            AppConfig.minPhotosPreventive = (d['minPhotosPreventive'] as num?)?.toInt() ?? AppConfig.minPhotosPreventive;
            AppConfig.minPhotosMouvement = (d['minPhotosMouvement'] as num?)?.toInt() ?? AppConfig.minPhotosMouvement;
          }
        },
      );
    } catch (_) {
      // Hors-ligne / non authentifié → on garde les valeurs par défaut.
    }
  }
}
