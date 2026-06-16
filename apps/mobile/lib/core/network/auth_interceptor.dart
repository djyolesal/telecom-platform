import 'dart:io';
import 'package:dio/dio.dart';
import 'package:dio/io.dart';
import '../constants/app_constants.dart';
import '../storage/secure_storage.dart';

const bool _allowSelfSigned = bool.fromEnvironment('ALLOW_SELF_SIGNED');

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

  @override
  Future<void> onRequest(RequestOptions options, RequestInterceptorHandler handler) async {
    final token = await _storage.accessToken;
    if (token != null && !options.path.contains('/auth/login')) {
      options.headers['Authorization'] = 'Bearer $token';
    }
    handler.next(options);
  }

  @override
  Future<void> onError(DioException err, ErrorInterceptorHandler handler) async {
    final is401 = err.response?.statusCode == 401;
    final isRetry = err.requestOptions.extra['__retried'] == true;
    final isAuthCall = err.requestOptions.path.contains('/auth/');

    if (is401 && !isRetry && !isAuthCall) {
      final refreshed = await _tryRefresh();
      if (refreshed != null) {
        final req = err.requestOptions;
        req.extra['__retried'] = true;
        req.headers['Authorization'] = 'Bearer $refreshed';
        try {
          final clone = await _refreshDio.fetch(req);
          return handler.resolve(clone);
        } catch (_) {
          // tombe dans le rejet ci-dessous
        }
      } else {
        onSessionExpired?.call();
      }
    }
    handler.next(err);
  }

  Future<String?> _tryRefresh() async {
    final refresh = await _storage.refreshToken;
    if (refresh == null) return null;
    try {
      final res = await _refreshDio.post('/auth/refresh-token', data: {'refreshToken': refresh});
      final data = res.data['data'] as Map<String, dynamic>;
      final access = data['accessToken'] as String;
      final newRefresh = data['refreshToken'] as String?;
      if (newRefresh != null) {
        await _storage.saveTokens(access: access, refresh: newRefresh);
      } else {
        await _storage.saveAccessToken(access);
      }
      return access;
    } catch (_) {
      return null;
    }
  }
}
