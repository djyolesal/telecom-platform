import '../network/dio_client.dart';

/// Règles terrain configurables côté serveur, récupérées via GET /config.
/// Valeurs par défaut sûres si le serveur n'a pas (encore) répondu.
class AppConfig {
  static int minDureeClotureMin = 60;
  static double geofenceRadiusM = 20;
  static int minPhotosPreventive = 6;
  static int minPhotosMouvement = 2;
  static int intervalleVidangeHeures = 250;

  /// Référentiel des types d'incident (code → libellé), éditable en admin et
  /// servi par /config : une évolution ne demande pas de nouvelle version de
  /// l'application. Repli sur la liste historique tant que rien n'est chargé.
  static Map<String, String> typesIncident = {
    'ALARME': 'Alarme',
    'COUPURE_CEET': 'Coupure CEET',
    'COUPURE_TOTALE': 'Coupure totale',
    'PANNE_GE': 'Panne GE',
    'INTRUSION': 'Intrusion',
    'VANDALISME': 'Vandalisme',
    'AUTRE': 'Autre',
  };
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
            AppConfig.intervalleVidangeHeures = (d['intervalleVidangeHeures'] as num?)?.toInt() ?? AppConfig.intervalleVidangeHeures;
            final types = d['typesIncident'];
            if (types is List && types.isNotEmpty) {
              AppConfig.typesIncident = {
                for (final t in types)
                  if (t is Map && t['code'] != null)
                    t['code'].toString(): t['libelle']?.toString() ?? t['code'].toString(),
              };
            }
          }
        },
      );
    } catch (_) {
      // Hors-ligne / non authentifié → on garde les valeurs par défaut.
    }
  }
}
