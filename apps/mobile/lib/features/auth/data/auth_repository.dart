import 'dart:io';
import 'package:device_info_plus/device_info_plus.dart';
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

  /// Identifiant stable de l'appareil (verrou du compte terrain sur le premier
  /// mobile connecté) : Android ID, ou identifierForVendor côté iOS.
  Future<({String? id, String? label})> _appareil() async {
    try {
      final plugin = DeviceInfoPlugin();
      if (Platform.isAndroid) {
        final info = await plugin.androidInfo;
        return (id: info.id, label: '${info.manufacturer} ${info.model}'.trim());
      }
      if (Platform.isIOS) {
        final info = await plugin.iosInfo;
        return (id: info.identifierForVendor, label: info.utsname.machine);
      }
    } catch (_) {/* identité indisponible → le serveur n'arme pas le verrou */}
    return (id: null, label: null);
  }

  /// Connexion par email/mot de passe. Stocke les jetons et l'utilisateur.
  Future<User> login(String email, String password) async {
    final appareil = await _appareil();
    final user = await _client.request(
      (dio) => dio.post('/auth/login', data: {
        'email': email,
        'password': password,
        'platform': 'MOBILE',
        if (appareil.id != null) 'deviceId': appareil.id,
        if (appareil.label != null) 'deviceLabel': appareil.label,
      }),
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
  /// `biometricOnly: false` : si l'empreinte échoue (doigts mouillés, capteur),
  /// Android propose le code/schéma de l'appareil en repli. Sans ce repli, un
  /// technicien HORS-LIGNE était enfermé dehors : le formulaire mot de passe
  /// exige le réseau, la biométrie était la seule porte.
  Future<bool> authenticateBiometric() async {
    try {
      return await _localAuth.authenticate(
        localizedReason: 'Authentifiez-vous pour accéder à E&M OpS',
        options: const AuthenticationOptions(stickyAuth: true, biometricOnly: false),
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
