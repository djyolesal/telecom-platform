import 'dart:typed_data';
import 'package:dio/dio.dart';
import '../network/dio_client.dart';
import '../errors/exceptions.dart';

/// Fichier stocké sur MinIO via l'API.
class UploadedFile {
  final String url;
  final String key;
  const UploadedFile({required this.url, required this.key});
  Map<String, String> toJson() => {'url': url, 'key': key};
}

/// Upload de fichiers (photos, signatures) vers MinIO via l'API.
/// Nécessite une connexion (MinIO).
class UploadService {
  final DioClient _client;
  UploadService(this._client);

  /// Upload d'une image en mémoire. Retourne {url, key}, ou `null` UNIQUEMENT si
  /// l'échec est réseau (hors-ligne → à réessayer). Une erreur SERVEUR (fichier
  /// rejeté 413, 500…) est PROPAGÉE : sinon elle serait prise pour un hors-ligne
  /// et bloquerait indéfiniment toute la file de synchronisation (head-of-line).
  Future<UploadedFile?> uploadImage(Uint8List bytes, String filename, {String folder = 'photos'}) async {
    final form = FormData.fromMap({
      'folder': folder,
      'file': MultipartFile.fromBytes(bytes, filename: filename),
    });
    try {
      return await _client.request<UploadedFile?>(
        (dio) => dio.post('/upload/image', data: form),
        (data) {
          final d = data is Map ? data['data'] as Map? : null;
          if (d == null) return null;
          return UploadedFile(url: d['url'] as String? ?? '', key: d['key'] as String? ?? '');
        },
      );
    } on NetworkException {
      return null; // hors-ligne réel → l'appelant remettra en file
    }
    // ServerException / UnauthorizedException se propagent → comptées comme échec
    // (l'entrée n'est pas rejouée en boucle, elle passe en « échec » après N essais).
  }
}
