import 'dart:io';
import 'dart:typed_data';
import 'package:path_provider/path_provider.dart';

/// Stockage local persistant des pièces jointes en attente d'upload
/// (photos prises à la caméra, signatures) pour la clôture offline-first.
///
/// Les fichiers temporaires d'`image_picker` peuvent être purgés par l'OS ;
/// on les recopie dans le dossier documents de l'app pour qu'ils survivent
/// jusqu'à la synchronisation, puis le SyncService les supprime après upload.
class AttachmentStore {
  static Future<Directory> _dir() async {
    final base = await getApplicationDocumentsDirectory();
    final dir = Directory('${base.path}/outbox_attachments');
    if (!await dir.exists()) await dir.create(recursive: true);
    return dir;
  }

  /// Copie un fichier source vers le stockage persistant. Retourne le chemin final.
  static Future<String> persistFile(String sourcePath) async {
    final dir = await _dir();
    final name = '${DateTime.now().microsecondsSinceEpoch}_${sourcePath.split('/').last}';
    final dest = File('${dir.path}/$name');
    await File(sourcePath).copy(dest.path);
    return dest.path;
  }

  /// Écrit des octets (ex: signature PNG) dans le stockage persistant.
  static Future<String> persistBytes(Uint8List bytes, String filename) async {
    final dir = await _dir();
    final dest = File('${dir.path}/${DateTime.now().microsecondsSinceEpoch}_$filename');
    await dest.writeAsBytes(bytes);
    return dest.path;
  }
}
