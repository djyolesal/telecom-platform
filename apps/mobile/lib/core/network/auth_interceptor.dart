import 'dart:async';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:dio/dio.dart';
import 'package:dio/io.dart';
import 'package:package_info_plus/package_info_plus.dart';
import '../constants/app_constants.dart';
import '../errors/exceptions.dart';
import '../storage/secure_storage.dart';

const bool _allowSelfSigned = kDebugMode && bool.fromEnvironment('ALLOW_SELF_SIGNED');

/// Attache le jeton d'accès à chaque requête et rafraîchit automatiquement
/// le jeton sur 401 (une seule tentative, puis rejoue la requête initiale).
class AuthInterceptor extends Interceptor {
  final SecureStorage _storage;
  // Dio dédié au refresh, sans intercepteur (évite la boucle de rafraîchissement).
  final Dio _refreshDio;
  final void Function()? onSessionExpired;

  AuthInterceptor(this._storage, {this.onSessionExpired})
      : _refreshDio = Dio(BaseOptions(baseUrl: AppConstants.apiBaseUrl)) {
    // Même tolérance au certificat auto-signé que le client principal.
    if (_allowSelfSigned) {
      _refreshDio.httpClientAdapter = IOHttpClientAdapter(
        createHttpClient: () {
          final client = HttpClient();
          client.badCertificateCallback = (cert, host, port) => true;
          return client;
        },
      );
    }
  }

  /// Version de l'app déclarée au serveur (suivi du parc mobile : savoir qui
  /// est encore sur un ancien APK au moment d'une bascule). Lue UNE fois et
  /// mémorisée — `PackageInfo.fromPlatform()` interroge la plateforme, inutile
  /// de recommencer à chaque requête. Purement informatif : si la lecture
  /// échoue, l'en-tête est simplement omis et rien n'est bloqué.
  static String? _versionApp;
  static Future<String?> versionApp() async {
    if (_versionApp != null) return _versionApp;
    try {
      final info = await PackageInfo.fromPlatform();
      return _versionApp = '${info.version}+${info.buildNumber}';
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> onRequest(RequestOptions options, RequestInterceptorHandler handler) async {
    final token = await _storage.accessToken;
    if (token != null && !options.path.contains('/auth/login')) {
      options.headers['Authorization'] = 'Bearer $token';
    }
    final v = await versionApp();
    if (v != null) options.headers['X-App-Version'] = v;
    handler.next(options);
  }

  @override
  Future<void> onError(DioException err, ErrorInterceptorHandler handler) async {
    final is401 = err.response?.statusCode == 401;
    final isRetry = err.requestOptions.extra['__retried'] == true;
    final isAuthCall = err.requestOptions.path.contains('/auth/');

    if (is401 && !isRetry && !isAuthCall) {
      String? refreshed;
      try {
        refreshed = await _tryRefresh();
      } on NetworkException {
        // Le refresh a échoué pour cause RÉSEAU (timeout/coupure), pas un refus
        // serveur : surtout ne pas déconnecter - on laisse l'erreur d'origine
        // remonter (la couche appelante la traite comme hors-ligne / mise en file).
        return handler.next(err);
      }
      if (refreshed != null) {
        final req = err.requestOptions;
        req.extra['__retried'] = true;
        req.headers['Authorization'] = 'Bearer $refreshed';
        try {
          final clone = await _refreshDio.fetch(req);
          return handler.resolve(clone);
        } on DioException catch (e2) {
          // Le rejeu a bien atteint le serveur, qui a répondu autre chose (422
          // vraisemblance, 409, 500…) : propager CETTE erreur. Renvoyer le 401
          // d'origine faisait passer une saisie valide pour une session expirée
          // - l'opération partait en file au lieu d'ouvrir la confirmation.
          if (e2.response != null && e2.response!.statusCode != 401) return handler.next(e2);
        } catch (_) {
          // rejeu impossible (FormData déjà consommée…) → rejet ci-dessous
        }
      } else {
        // refreshed == null → refus explicite du serveur (session révoquée) : logout.
        onSessionExpired?.call();
      }
    }
    handler.next(err);
  }

  // Verrou : plusieurs requêtes en 401 simultanées (le dashboard en tire ~5)
  // ne doivent lancer QU'UN SEUL refresh. Sinon, avec la rotation single-use des
  // refresh tokens, le 2e appel échoue et déconnecte une session pourtant valide.
  Future<String?>? _refreshing;

  Future<String?> _tryRefresh() {
    // Un refresh est déjà en cours → on attend son résultat (pas un 2e appel).
    return _refreshing ??= _doRefresh().whenComplete(() => _refreshing = null);
  }

  /// Renvoie un nouveau jeton d'accès, ou null si le serveur REFUSE le refresh
  /// (session révoquée). Lève NetworkException si l'échec est purement réseau
  /// (timeout/coupure) → l'appelant ne doit alors PAS déconnecter.
  Future<String?> _doRefresh() async {
    final refresh = await _storage.refreshToken;
    if (refresh == null) return null;
    try {
      // _refreshDio n'a AUCUN intercepteur (anti-boucle) : l'en-tête de version
      // doit donc être posé à la main ici. C'est le point qui voit passer les
      // téléphones toutes les 12 h, sans attendre une reconnexion — rare sur le
      // terrain, où la session dure des semaines.
      final v = await versionApp();
      final res = await _refreshDio.post(
        '/auth/refresh-token',
        data: {'refreshToken': refresh},
        options: v == null ? null : Options(headers: {'X-App-Version': v}),
      );
      final data = res.data['data'] as Map<String, dynamic>;
      final access = data['accessToken'] as String;
      final newRefresh = data['refreshToken'] as String?;
      if (newRefresh != null) {
        await _storage.saveTokens(access: access, refresh: newRefresh);
      } else {
        await _storage.saveAccessToken(access);
      }
      return access;
    } on DioException catch (e) {
      // Coupure/timeout réseau → pas un refus : on remonte NetworkException.
      // `unknown` + SocketException = aussi une coupure (mode avion selon les
      // versions d'Android) : la prendre pour un refus déconnectait la session
      // en pleine zone blanche.
      if (e.type == DioExceptionType.connectionError ||
          e.type == DioExceptionType.connectionTimeout ||
          e.type == DioExceptionType.receiveTimeout ||
          e.type == DioExceptionType.sendTimeout ||
          (e.type == DioExceptionType.unknown && e.error is SocketException)) {
        throw const NetworkException();
      }
      // SEUL un refus explicite du serveur tue la session. Un 429 (débit) ou un
      // 5xx (API en cours de redémarrage) est TRANSITOIRE : les prendre pour un
      // refus déconnectait le technicien en pleine tournée, qui devait se
      // reconnecter — et sa reconnexion se heurtait au même plafond.
      // 400 = jeton absent/illisible, 401/403 = refus explicite : irrécupérable.
      final code = e.response?.statusCode ?? 0;
      if (code == 400 || code == 401 || code == 403) return null; // session morte
      throw const NetworkException();
    }
  }
}
