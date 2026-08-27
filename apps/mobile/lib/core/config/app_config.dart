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

  /// Référentiel des équipements de dépannage (code → libellé + catégorie
  /// contractuelle), même mécanique que [typesIncident] : servi par /config,
  /// repli sur la liste semée en base tant que rien n'est chargé.
  static List<Map<String, String>> equipements = [
    {'code': 'ANTENNE_FH', 'libelle': 'Antenne / FH', 'categorie': 'ANTENNE'},
    {
      'code': 'ATELIER_ENERGIE',
      'libelle': 'Atelier d\'énergie',
      'categorie': 'AUTRE'
    },
    {
      'code': 'ATS',
      'libelle': 'ATS (inverseur de sources)',
      'categorie': 'AUTRE'
    },
    {'code': 'BATTERIES', 'libelle': 'Batteries', 'categorie': 'BATTERIE'},
    {
      'code': 'CLIMATISEUR',
      'libelle': 'Climatiseur',
      'categorie': 'CLIMATISEUR'
    },
    {'code': 'COMPTEUR_CEET', 'libelle': 'Compteur CEET', 'categorie': 'AUTRE'},
    {'code': 'GE', 'libelle': 'Groupe électrogène', 'categorie': 'GE'},
    {
      'code': 'PANNEAUX_REGULATEUR',
      'libelle': 'Panneaux / régulateur solaire',
      'categorie': 'SOLAIRE'
    },
    {
      'code': 'PYLONE_BALISAGE',
      'libelle': 'Pylône / balisage',
      'categorie': 'AUTRE'
    },
    {'code': 'REDRESSEURS', 'libelle': 'Redresseurs', 'categorie': 'RESEAU'},
    {'code': 'TGBT', 'libelle': 'TGBT', 'categorie': 'AUTRE'},
  ];
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
            AppConfig.minDureeClotureMin =
                (d['minDureeClotureMin'] as num?)?.toInt() ??
                    AppConfig.minDureeClotureMin;
            AppConfig.geofenceRadiusM =
                (d['geofenceRadiusM'] as num?)?.toDouble() ??
                    AppConfig.geofenceRadiusM;
            AppConfig.minPhotosPreventive =
                (d['minPhotosPreventive'] as num?)?.toInt() ??
                    AppConfig.minPhotosPreventive;
            AppConfig.minPhotosMouvement =
                (d['minPhotosMouvement'] as num?)?.toInt() ??
                    AppConfig.minPhotosMouvement;
            AppConfig.intervalleVidangeHeures =
                (d['intervalleVidangeHeures'] as num?)?.toInt() ??
                    AppConfig.intervalleVidangeHeures;
            final types = d['typesIncident'];
            if (types is List && types.isNotEmpty) {
              AppConfig.typesIncident = {
                for (final t in types)
                  if (t is Map && t['code'] != null)
                    t['code'].toString():
                        t['libelle']?.toString() ?? t['code'].toString(),
              };
            }
            final equips = d['equipements'];
            if (equips is List && equips.isNotEmpty) {
              AppConfig.equipements = [
                for (final e in equips)
                  if (e is Map && e['code'] != null)
                    {
                      'code': e['code'].toString(),
                      'libelle':
                          e['libelle']?.toString() ?? e['code'].toString(),
                      'categorie': e['categorie']?.toString() ?? 'AUTRE',
                    },
              ];
            }
          }
        },
      );
    } catch (_) {
      // Hors-ligne / non authentifié → on garde les valeurs par défaut.
    }
  }
}
