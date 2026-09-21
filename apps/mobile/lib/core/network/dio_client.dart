import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:dio/dio.dart';
import 'package:dio/io.dart';
import 'package:logger/logger.dart';
import '../constants/app_constants.dart';
import '../errors/exceptions.dart';
import '../storage/secure_storage.dart';
import 'auth_interceptor.dart';

/// Active l'acceptation des certificats TLS auto-signés.
/// À passer au build pour un serveur en HTTPS auto-signé (IP sans domaine) :
///   flutter build apk --dart-define=ALLOW_SELF_SIGNED=true --dart-define=API_URL=https://<IP>/api/v1
/// Acceptation des certificats TLS auto-signés - **jamais en build de release**.
/// Le `--dart-define` seul suffisait à désactiver la validation TLS dans un APK
/// distribué : un APK de recette signé par erreur, ou un simple oubli du flag
/// dans le script de build, exposait tout le trafic terrain à l'interception.
/// Le domaine de production (emops.uk) a un certificat Let's Encrypt valide ;
/// le contournement n'a de sens qu'en debug, face à une IP nue.
const bool _allowSelfSigned = kDebugMode && bool.fromEnvironment('ALLOW_SELF_SIGNED');

/// Client HTTP central (Dio) avec intercepteurs auth/retry et journalisation.
class DioClient {
  late final Dio dio;
  final _logger = Logger(printer: PrettyPrinter(methodCount: 0));

  DioClient(SecureStorage storage, {void Function()? onSessionExpired}) {
    dio = Dio(
      BaseOptions(
        baseUrl: AppConstants.apiBaseUrl,
        connectTimeout: AppConstants.connectTimeout,
        receiveTimeout: AppConstants.receiveTimeout,
        contentType: 'application/json',
        // validateStatus par défaut (2xx = succès) : les 4xx deviennent des
        // DioException, ce qui permet à l'AuthInterceptor de gérer les 401.
      ),
    );

    // Serveur en HTTPS auto-signé : faire confiance au certificat (flag de build).
    if (_allowSelfSigned) {
      dio.httpClientAdapter = IOHttpClientAdapter(
        createHttpClient: () {
          final client = HttpClient();
          client.badCertificateCallback = (cert, host, port) => true;
          return client;
        },
      );
    }

    dio.interceptors.add(AuthInterceptor(storage, onSessionExpired: onSessionExpired));
    dio.interceptors.add(_RetryInterceptor(dio, _logger));

    assert(() {
      dio.interceptors.add(LogInterceptor(requestBody: true, responseBody: false));
      return true;
    }());
  }

  /// Normalise les réponses : déballe l'enveloppe { success, data, meta }.
  Future<T> request<T>(Future<Response> Function(Dio) call, T Function(dynamic data) parse) async {
    try {
      final res = await call(dio);
      return parse(res.data);
    } on DioException catch (e) {
      // TOUTES les formes d'absence de réseau doivent devenir NetworkException :
      // selon la version d'Android et le moment de la coupure, un mode avion se
      // manifeste aussi en `unknown` (SocketException enveloppée) ou en
      // `sendTimeout` (coupure pendant l'envoi). Les traiter en « erreur
      // serveur » brûlait les essais de la file de sync - l'opération hors-ligne
      // finissait en échec définitif au lieu d'attendre le réseau.
      if (e.type == DioExceptionType.connectionError ||
          e.type == DioExceptionType.connectionTimeout ||
          e.type == DioExceptionType.receiveTimeout ||
          e.type == DioExceptionType.sendTimeout ||
          (e.type == DioExceptionType.unknown && e.error is SocketException)) {
        throw const NetworkException();
      }
      final status = e.response?.statusCode;
      final data = e.response?.data;
      // Un 502/503/504 vient de nginx, PAS de l'API : le corps est une page
      // HTML, donc `data['error']` est absent et `e.message` est le texte
      // technique anglais de Dio (« RequestOptions.validateStatus… »). Le
      // technicien ne doit jamais lire ça : on rédige le message ici.
      final msg = data is Map && data['error'] != null
          ? data['error'].toString()
          : _messageStatut(status) ?? (e.message ?? 'Erreur réseau');
      if (status == 401) throw UnauthorizedException(msg);
      // Avertissements de vraisemblance (422) : conservés pour que l'UI propose
      // au technicien de vérifier puis confirmer sa saisie.
      final avert = data is Map && data['avertissements'] is List
          ? (data['avertissements'] as List)
              .map((a) => a is Map ? (a['message'] ?? '').toString() : a.toString())
              .where((m) => m.isNotEmpty)
              .toList()
          : const <String>[];
      throw ServerException(msg, statusCode: status, avertissements: avert);
    }
  }
}

/// Réessaie automatiquement les requêtes GET en cas d'erreur réseau transitoire.
class _RetryInterceptor extends Interceptor {
  final Dio dio;
  final Logger logger;
  static const _maxRetries = 2;

  _RetryInterceptor(this.dio, this.logger);

  @override
  Future<void> onError(DioException err, ErrorInterceptorHandler handler) async {
    final retries = (err.requestOptions.extra['__retries'] as int?) ?? 0;
    // Une passerelle qui redémarre (502/503/504) est aussi transitoire qu'une
    // coupure réseau : sur une LECTURE, deux essais espacés suffisent en
    // général à traverser la fenêtre de redémarrage de l'API, au lieu de
    // laisser un écran d'erreur au technicien.
    final isTransient = err.type == DioExceptionType.connectionTimeout ||
        err.type == DioExceptionType.receiveTimeout ||
        err.type == DioExceptionType.connectionError ||
        (err.type == DioExceptionType.unknown && err.error is SocketException) ||
        _passerelleIndisponible(err.response?.statusCode);

    if (isTransient && err.requestOptions.method == 'GET' && retries < _maxRetries) {
      final next = retries + 1;
      err.requestOptions.extra['__retries'] = next;
      await Future.delayed(Duration(milliseconds: 400 * next));
      try {
        final res = await dio.fetch(err.requestOptions);
        return handler.resolve(res);
      } catch (_) {
        // continue vers le rejet
      }
    }
    handler.next(err);
  }
}

/// Statuts d'une passerelle momentanément incapable de joindre l'API.
bool _passerelleIndisponible(int? s) => s == 502 || s == 503 || s == 504;

/// Message métier pour les statuts dont le corps ne vient pas de l'API.
String? _messageStatut(int? s) {
  if (_passerelleIndisponible(s)) {
    return 'Serveur momentanément indisponible - réessayez dans un instant.';
  }
  if (s == 413) return 'Envoi trop volumineux - reprenez la photo.';
  if (s == 429) return 'Trop de tentatives - patientez quelques minutes.';
  if (s != null && s >= 500) {
    return 'Le serveur a rencontré une erreur - réessayez, puis prévenez votre superviseur si cela persiste.';
  }
  return null;
}
