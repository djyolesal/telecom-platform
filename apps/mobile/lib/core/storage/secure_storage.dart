import 'dart:convert';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';
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

  /// Identifiant de l'utilisateur connecté (cloisonnement de la file d'attente
  /// sur un téléphone de service partagé). Null si aucune session.
  Future<String?> readUserId() async {
    final brut = await userJson;
    if (brut == null) return null;
    try {
      final m = jsonDecode(brut);
      return m is Map && m['id'] != null ? m['id'].toString() : null;
    } catch (_) {
      return null;
    }
  }

  Future<void> setBiometricEnabled(bool enabled) =>
      _storage.write(key: AppConstants.kBiometricEnabled, value: enabled.toString());
  Future<bool> get biometricEnabled async =>
      (await _storage.read(key: AppConstants.kBiometricEnabled)) == 'true';

  /// IDENTIFIANT DE L'APPAREIL, tiré une fois pour toutes au premier lancement.
  ///
  /// Le verrou d'appareil utilisait `AndroidDeviceInfo.id`, qui est `Build.ID` :
  /// l'identifiant du FIRMWARE, identique sur tous les téléphones d'un même
  /// modèle. Treize comptes se retrouvaient ainsi « sur le même appareil », et
  /// le verrou bilatéral aurait refusé la connexion à douze techniciens
  /// innocents. Un UUID tiré au sort ici ne peut, lui, désigner qu'un seul
  /// téléphone.
  ///
  /// Il vit dans le Keystore : il traverse les mises à jour de l'APK, et
  /// disparaît avec l'application - une réinstallation redemande donc une
  /// déliaison par un administrateur, ce qui est le bon sens de l'erreur.
  Future<String> appareilUuid() async {
    final existant = await _storage.read(key: AppConstants.kAppareilUuid);
    if (existant != null && existant.isNotEmpty) return existant;
    final nouveau = const Uuid().v4();
    await _storage.write(key: AppConstants.kAppareilUuid, value: nouveau);
    return nouveau;
  }

  Future<bool> get hasSession async => (await refreshToken) != null;

  Future<void> clear() async {
    await _storage.delete(key: AppConstants.kAccessToken);
    await _storage.delete(key: AppConstants.kRefreshToken);
    await _storage.delete(key: AppConstants.kUserJson);
  }
}
