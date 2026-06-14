import 'dart:typed_data';
import 'package:dio/dio.dart';
import '../network/dio_client.dart';

/// Upload de fichiers (photos, signatures) vers MinIO via l'API.
/// Nécessite une connexion : en mode hors-ligne, les écritures sont mises en file
/// sans pièce jointe.
class UploadService {
  final DioClient _client;
  UploadService(this._client);

  /// Upload d'une image en mémoire. Retourne la clé MinIO ou null en cas d'échec.
  Future<String?> uploadImage(Uint8List bytes, String filename, {String folder = 'signatures'}) async {
    try {
      final form = FormData.fromMap({
        'folder': folder,
        'file': MultipartFile.fromBytes(bytes, filename: filename),
      });
      return await _client.request<String?>(
        (dio) => dio.post('/upload/image', data: form),
        (data) => data is Map ? (data['data']?['key'] as String?) : null,
      );
    } catch (_) {
      return null;
    }
  }
}
