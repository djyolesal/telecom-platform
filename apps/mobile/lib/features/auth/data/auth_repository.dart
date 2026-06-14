import 'package:local_auth/local_auth.dart';
import '../../../core/network/dio_client.dart';
import '../../../core/storage/secure_storage.dart';
import '../../../core/errors/exceptions.dart';
import '../domain/user.dart';

/// Gère l'authentification : login API, session locale et biométrie.
class AuthRepository {
  final DioClient _client;
  final SecureStorage _storage;
  final LocalAuthentication _localAuth;

  AuthRepository(this._client, this._storage, [LocalAuthentication? localAuth])
      : _localAuth = localAuth ?? LocalAuthentication();

  /// Connexion par email/mot de passe. Stocke les jetons et l'utilisateur.
  Future<User> login(String email, String password) async {
    final user = await _client.request(
      (dio) => dio.post('/auth/login', data: {'email': email, 'password': password}),
      (data) {
        final d = data['data'] as Map<String, dynamic>;
        return (
          user: User.fromJson(d['user'] as Map<String, dynamic>),
          access: d['accessToken'] as String,
          refresh: d['refreshToken'] as String,
        );
      },
    );
    await _storage.saveTokens(access: user.access, refresh: user.refresh);
    await _storage.saveUserJson(user.user.encode());
    return user.user;
  }

  Future<void> logout() async {
    try {
      await _client.request((dio) => dio.post('/auth/logout'), (_) => null);
    } catch (_) {
      // déconnexion locale même si l'appel échoue (hors-ligne)
    }
    await _storage.clear();
  }

  /// Récupère l'utilisateur courant depuis l'API (et rafraîchit le cache local).
  Future<User> me() async {
    final user = await _client.request(
      (dio) => dio.get('/auth/me'),
      (data) => User.fromJson(data['data'] as Map<String, dynamic>),
    );
    await _storage.saveUserJson(user.encode());
    return user;
  }

  /// Utilisateur en cache (hors-ligne).
  Future<User?> cachedUser() async {
    final json = await _storage.userJson;
    if (json == null) return null;
    try {
      return User.decode(json);
    } catch (_) {
      return null;
    }
  }

  Future<bool> get hasSession => _storage.hasSession;

  // ── Biométrie ──────────────────────────────────────────────
  Future<bool> get biometricAvailable async {
    try {
      return await _localAuth.canCheckBiometrics && await _localAuth.isDeviceSupported();
    } catch (_) {
      return false;
    }
  }

  Future<bool> get biometricEnabled => _storage.biometricEnabled;
  Future<void> setBiometricEnabled(bool v) => _storage.setBiometricEnabled(v);

  /// Demande l'authentification biométrique de l'utilisateur.
  Future<bool> authenticateBiometric() async {
    try {
      return await _localAuth.authenticate(
        localizedReason: 'Authentifiez-vous pour accéder à TélécomOps',
        options: const AuthenticationOptions(stickyAuth: true, biometricOnly: true),
      );
    } catch (_) {
      return false;
    }
  }

  Future<void> updateFcmToken(String token) async {
    try {
      await _client.request(
        (dio) => dio.post('/auth/fcm-token', data: {'token': token}),
        (_) => null,
      );
    } on ServerException {
      // non bloquant
    }
  }
}
