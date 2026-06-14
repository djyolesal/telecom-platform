import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../constants/app_constants.dart';

/// Stockage sécurisé (Keychain iOS / Keystore Android) pour les jetons et la session.
class SecureStorage {
  final FlutterSecureStorage _storage;

  SecureStorage([FlutterSecureStorage? storage])
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(encryptedSharedPreferences: true),
            );

  Future<void> saveTokens({required String access, required String refresh}) async {
    await _storage.write(key: AppConstants.kAccessToken, value: access);
    await _storage.write(key: AppConstants.kRefreshToken, value: refresh);
  }

  Future<String?> get accessToken => _storage.read(key: AppConstants.kAccessToken);
  Future<String?> get refreshToken => _storage.read(key: AppConstants.kRefreshToken);

  Future<void> saveAccessToken(String access) =>
      _storage.write(key: AppConstants.kAccessToken, value: access);

  Future<void> saveUserJson(String json) =>
      _storage.write(key: AppConstants.kUserJson, value: json);
  Future<String?> get userJson => _storage.read(key: AppConstants.kUserJson);

  Future<void> setBiometricEnabled(bool enabled) =>
      _storage.write(key: AppConstants.kBiometricEnabled, value: enabled.toString());
  Future<bool> get biometricEnabled async =>
      (await _storage.read(key: AppConstants.kBiometricEnabled)) == 'true';

  Future<bool> get hasSession async => (await refreshToken) != null;

  Future<void> clear() async {
    await _storage.delete(key: AppConstants.kAccessToken);
    await _storage.delete(key: AppConstants.kRefreshToken);
    await _storage.delete(key: AppConstants.kUserJson);
  }
}
