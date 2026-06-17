import 'dart:typed_data';
import 'package:dio/dio.dart';
import '../network/dio_client.dart';

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

  /// Upload d'une image en mémoire. Retourne {url, key} ou null en cas d'échec.
  Future<UploadedFile?> uploadImage(Uint8List bytes, String filename, {String folder = 'photos'}) async {
    try {
      final form = FormData.fromMap({
        'folder': folder,
        'file': MultipartFile.fromBytes(bytes, filename: filename),
      });
      return await _client.request<UploadedFile?>(
        (dio) => dio.post('/upload/image', data: form),
        (data) {
          final d = data is Map ? data['data'] as Map? : null;
          if (d == null) return null;
          return UploadedFile(url: d['url'] as String? ?? '', key: d['key'] as String? ?? '');
        },
      );
    } catch (_) {
      return null;
    }
  }
}
