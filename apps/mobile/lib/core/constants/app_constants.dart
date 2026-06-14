/// Constantes globales de l'application.
class AppConstants {
  AppConstants._();

  /// URL de base de l'API. Surchargée au build via --dart-define=API_URL=...
  static const String apiBaseUrl = String.fromEnvironment(
    'API_URL',
    defaultValue: 'https://telecom.votredomaine.tg/api/v1',
  );

  static const Duration connectTimeout = Duration(seconds: 20);
  static const Duration receiveTimeout = Duration(seconds: 30);

  // Clés de stockage sécurisé
  static const String kAccessToken = 'access_token';
  static const String kRefreshToken = 'refresh_token';
  static const String kUserJson = 'user_json';
  static const String kBiometricEnabled = 'biometric_enabled';

  // Box Hive
  static const String kSettingsBox = 'settings';

  // Pagination
  static const int defaultPageSize = 20;
}
