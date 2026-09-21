import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:telecom_mobile/core/errors/exceptions.dart';
import 'package:telecom_mobile/core/network/dio_client.dart';
import 'package:telecom_mobile/core/storage/secure_storage.dart';

/// Passerelle en panne : reproduit EXACTEMENT ce que voit le terrain quand
/// nginx répond 502 (corps HTML, aucun message de l'API) pendant que l'API
/// redémarre. Sans ces garde-fous, l'écran affichait le texte technique anglais
/// de Dio (« RequestOptions.validateStatus… ») et n'essayait même pas à nouveau.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    // Le binding de test remplace HttpClient par un bouchon qui répond 400 à
    // tout : on rend la vraie pile HTTP pour parler à notre serveur local.
    HttpOverrides.global = null;
    // flutter_secure_storage passe par un canal de plateforme, absent en test.
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
      const MethodChannel('plugins.it_nomads.com/flutter_secure_storage'),
      (_) async => null,
    );
  });

  /// Serveur qui renvoie [echecs] fois un 502 façon nginx, puis un 200.
  Future<(HttpServer, List<String>)> passerelle(int echecs) async {
    final vues = <String>[];
    final serveur = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    serveur.listen((req) async {
      vues.add(req.method);
      if (vues.length <= echecs) {
        req.response
          ..statusCode = 502
          ..headers.contentType = ContentType.html
          ..write('<html><head><title>502 Bad Gateway</title></head></html>');
      } else {
        req.response
          ..statusCode = 200
          ..headers.contentType = ContentType.json
          ..write(jsonEncode({'success': true, 'data': []}));
      }
      await req.response.close();
    });
    return (serveur, vues);
  }

  DioClient client() => DioClient(SecureStorage(const FlutterSecureStorage()));

  test('502 persistant : message en français, jamais le texte de Dio', () async {
    final (serveur, vues) = await passerelle(99);
    try {
      final c = client();
      Object? erreur;
      try {
        await c.request(
          (d) => d.get('http://127.0.0.1:${serveur.port}/maintenances'),
          (data) => data,
        );
      } catch (e) {
        erreur = e;
      }
      expect(erreur, isA<ServerException>());
      final message = messageMetier(erreur!);
      expect(message, 'Serveur momentanément indisponible - réessayez dans un instant.');
      expect(message, isNot(contains('validateStatus')));
      expect(message, isNot(contains('status code')));
      // La lecture a bien été retentée (1 essai + 2 reprises).
      expect(vues.length, 3);
    } finally {
      await serveur.close(force: true);
    }
  });

  test('502 le temps d\'un redémarrage : la lecture aboutit d\'elle-même', () async {
    final (serveur, vues) = await passerelle(2);
    try {
      final res = await client().request(
        (d) => d.get('http://127.0.0.1:${serveur.port}/maintenances'),
        (data) => (data as Map)['data'],
      );
      expect(res, isEmpty);
      expect(vues.length, 3);
    } finally {
      await serveur.close(force: true);
    }
  });

  test('une ÉCRITURE en 502 n\'est jamais rejouée', () async {
    final (serveur, vues) = await passerelle(99);
    try {
      await expectLater(
        client().request(
          (d) => d.post('http://127.0.0.1:${serveur.port}/maintenances', data: {'x': 1}),
          (data) => data,
        ),
        throwsA(isA<ServerException>()),
      );
      expect(vues.length, 1, reason: 'un POST rejoué créerait un doublon');
    } finally {
      await serveur.close(force: true);
    }
  });
}
