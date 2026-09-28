import 'dart:io';
import 'package:flutter/foundation.dart';
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

  /// Identifiant de CE téléphone (verrou du compte terrain sur le premier
  /// mobile connecté), et son modèle pour l'affichage côté administration.
  ///
  /// L'identifiant venait d'`AndroidDeviceInfo.id`, que le commentaire prenait
  /// pour l'Android ID alors que c'est `Build.ID` : le numéro du FIRMWARE,
  /// identique sur tous les exemplaires d'un même modèle. Le verrou liait donc
  /// un modèle de téléphone, pas un téléphone - jusqu'à treize comptes sur un
  /// seul « appareil ». On tire désormais un UUID, conservé dans le Keystore.
  ///
  /// Le modèle, lui, reste l'étiquette lisible : il ne sert qu'à nommer
  /// l'appareil à l'écran, jamais à l'identifier.
  Future<({String? id, String? label})> _appareil() async {
    final id = await _storage.appareilUuid();
    try {
      final plugin = DeviceInfoPlugin();
      if (Platform.isAndroid) {
        final info = await plugin.androidInfo;
        return (id: id, label: '${info.manufacturer} ${info.model}'.trim());
      }
      if (Platform.isIOS) {
        final info = await plugin.iosInfo;
        return (id: id, label: info.utsname.machine);
      }
    } catch (_) {/* modèle indisponible : l'identifiant, lui, suffit au verrou */}
    return (id: id, label: null);
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
  /// Un appareil SÉCURISÉ suffit (empreinte, visage OU code/schéma) : le
  /// déverrouillage accepte le code en repli (biometricOnly=false). Exiger
  /// `canCheckBiometrics` masquait l'option sur les téléphones sans empreinte
  /// ENREGISTRÉE - dont des Samsung déverrouillés par code ou visage.
  Future<bool> get biometricAvailable async {
    try {
      final supporte = await _localAuth.isDeviceSupported();
      final capteurs = await _localAuth.canCheckBiometrics;
      // Diagnostic visible uniquement en debug (logcat) : les réponses brutes
      // d'Android varient énormément d'un constructeur à l'autre.
      debugPrint('[verrou] isDeviceSupported=$supporte canCheckBiometrics=$capteurs');
      return supporte || capteurs;
    } catch (e) {
      debugPrint('[verrou] disponibilité indéterminable : $e');
      return false;
    }
  }

  Future<bool> get biometricEnabled => _storage.biometricEnabled;
  Future<void> setBiometricEnabled(bool v) => _storage.setBiometricEnabled(v);

  /// Vérifie l'identité pour un acte ENGAGEANT (clôture d'intervention) et dit
  /// PAR QUEL facteur.
  ///
  /// L'empreinte ou le visage d'abord (`biometricOnly: true`) : le code de
  /// l'appareil se prête aussi facilement que le téléphone, une empreinte non.
  /// S'il n'y en a aucune d'enregistrée - téléphone d'entrée de gamme, capteur
  /// hors service - on retombe sur le code plutôt que d'empêcher de
  /// travailler, mais le serveur enregistre que c'était le code.
  ///
  /// Renvoie 'BIOMETRIE', 'CODE' ou null si la vérification a échoué.
  Future<String?> verifierIdentite() async {
    try {
      final biometrie = await _localAuth.authenticate(
        localizedReason: 'Vérifiez votre identité pour clôturer l\'intervention',
        options: const AuthenticationOptions(stickyAuth: true, biometricOnly: true),
      );
      if (biometrie) return 'BIOMETRIE';
    } catch (_) {
      // Aucune biométrie enregistrée sur cet appareil : on tente le code.
    }
    try {
      final code = await _localAuth.authenticate(
        localizedReason: 'Vérifiez votre identité pour clôturer l\'intervention',
        options: const AuthenticationOptions(stickyAuth: true, biometricOnly: false),
      );
      return code ? 'CODE' : null;
    } catch (_) {
      return null;
    }
  }

  /// Demande l'authentification biométrique de l'utilisateur.
  /// `biometricOnly: false` : si l'empreinte échoue (doigts mouillés, capteur),
  /// Android propose le code/schéma de l'appareil en repli. Sans ce repli, un
  /// technicien HORS-LIGNE était enfermé dehors : le formulaire mot de passe
  /// exige le réseau, la biométrie était la seule porte.
  Future<bool> authenticateBiometric() async {
    try {
      return await _localAuth.authenticate(
        localizedReason: 'Authentifiez-vous pour accéder à E&M OpS',
        options:
            const AuthenticationOptions(stickyAuth: true, biometricOnly: false),
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
