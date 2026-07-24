import 'dart:convert';
import 'dart:io';
import 'package:path_provider/path_provider.dart';

/// Cache LOCAL de lecture des maintenances (JSON brut de l'API), pour que le
/// terrain reste utilisable hors réseau : la liste et le détail se servent du
/// dernier instantané connu. Les transitions mises en file (démarrage, pause,
/// reprise, clôture) sont appliquées OPTIMISTEMENT ici pour que l'écran reflète
/// l'état réel du travail — le serveur reste la vérité à la resynchronisation.
class MaintenanceCache {
  static Future<File> _file() async {
    final dir = await getApplicationDocumentsDirectory();
    return File('${dir.path}/maintenances_cache.json');
  }

  /// Remplace l'instantané (appelé après chaque liste rechargée en ligne).
  static Future<void> saveList(List<Map<String, dynamic>> raw) async {
    try {
      final f = await _file();
      await f.writeAsString(jsonEncode({'savedAt': DateTime.now().toIso8601String(), 'items': raw}));
    } catch (_) {/* cache = confort, jamais bloquant */}
  }

  static Future<List<Map<String, dynamic>>> readList() async {
    try {
      final f = await _file();
      if (!await f.exists()) return const [];
      final raw = jsonDecode(await f.readAsString());
      final items = (raw is Map ? raw['items'] : null) as List?;
      return items?.whereType<Map>().map((e) => e.cast<String, dynamic>()).toList() ?? const [];
    } catch (_) {
      return const [];
    }
  }

  static Future<Map<String, dynamic>?> byId(String id) async {
    final items = await readList();
    for (final m in items) {
      if (m['id'] == id) return m;
    }
    return null;
  }

  /// Fusionne un détail frais (en ligne) dans l'instantané, sans en changer l'ordre.
  static Future<void> upsert(Map<String, dynamic> item) async {
    final items = await readList();
    final i = items.indexWhere((m) => m['id'] == item['id']);
    if (i >= 0) {
      items[i] = item;
    } else {
      items.insert(0, item);
    }
    await saveList(items);
  }

  /// Transition optimiste d'une opération MISE EN FILE (hors-ligne) : l'écran
  /// doit montrer l'état réel du travail (boutons Clôturer/Suspendre après un
  /// démarrage hors réseau, etc.).
  static Future<void> patch(String id, Map<String, dynamic> champs) async {
    final items = await readList();
    final i = items.indexWhere((m) => m['id'] == id);
    if (i < 0) return;
    items[i] = {...items[i], ...champs};
    await saveList(items);
  }
}
