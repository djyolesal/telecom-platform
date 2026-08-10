import 'dart:convert';
import 'dart:io';
import 'package:path_provider/path_provider.dart';

/// Brouillon LOCAL du formulaire de dépotage : protège la saisie terrain (jauges,
/// 6 photos, 3 signatures, agent, index GE) si l'app est tuée par Android pendant
/// la prise de photo. Un seul brouillon à la fois (le dépotage est séquentiel).
/// Les photos/signatures sont déjà des fichiers persistés (AttachmentStore) ; on
/// ne mémorise que leurs chemins + les champs texte.
class DepotageDraft {
  static Future<File> _file() async {
    final dir = await getApplicationDocumentsDirectory();
    return File('${dir.path}/depotage_draft.json');
  }

  static Future<void> save(Map<String, dynamic> data) async {
    try {
      final f = await _file();
      await f.writeAsString(
          jsonEncode({...data, 'savedAt': DateTime.now().toIso8601String()}));
    } catch (_) {/* le brouillon est un confort, jamais bloquant */}
  }

  static Future<Map<String, dynamic>?> load() async {
    try {
      final f = await _file();
      if (!await f.exists()) return null;
      final raw = jsonDecode(await f.readAsString());
      return raw is Map<String, dynamic> ? raw : null;
    } catch (_) {
      return null;
    }
  }

  static Future<void> clear() async {
    try {
      final f = await _file();
      if (await f.exists()) await f.delete();
    } catch (_) {/* ignore */}
  }
}
