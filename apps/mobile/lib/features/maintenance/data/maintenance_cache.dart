import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:path_provider/path_provider.dart';

/// Cache LOCAL de lecture des maintenances (JSON brut de l'API), pour que le
/// terrain reste utilisable hors réseau : la liste et le détail se servent du
/// dernier instantané connu. Les transitions mises en file (démarrage, pause,
/// reprise, clôture) sont appliquées OPTIMISTEMENT ici pour que l'écran reflète
/// l'état réel du travail - le serveur reste la vérité à la resynchronisation.
class MaintenanceCache {
  /// Toutes les écritures passent par cette file : `saveList` (rafraîchissement
  /// de liste) et `patch` (transition optimiste) sont des read-modify-write sur
  /// le MÊME fichier - concurrents, l'un écrasait l'autre.
  static Future<void> _chaine = Future.value();
  static Future<T> _serialise<T>(Future<T> Function() action) {
    final resultat = _chaine.then((_) => action());
    _chaine = resultat.then((_) {}, onError: (_) {});
    return resultat;
  }

  /// Écriture ATOMIQUE (fichier temporaire puis rename) : une app tuée en plein
  /// writeAsString laissait un JSON tronqué - au prochain démarrage le cache
  /// était illisible et le technicien partait en tournée sans aucune donnée.
  static Future<void> _ecrire(Map<String, dynamic> contenu) async {
    final f = await _fichier();
    final tmp = File('${f.path}.tmp');
    await tmp.writeAsString(jsonEncode(contenu), flush: true);
    await tmp.rename(f.path);
  }

  static Future<File> _fichier() async {
    final dir = await getApplicationDocumentsDirectory();
    return File('${dir.path}/maintenances_cache.json');
  }

  /// Remplace l'instantané (appelé après chaque liste rechargée en ligne).
  static Future<void> saveList(List<Map<String, dynamic>> raw) =>
      _serialise(() async {
        try {
          await _ecrire(
              {'savedAt': DateTime.now().toIso8601String(), 'items': raw});
        } catch (_) {/* cache = confort, jamais bloquant */}
      });

  static Future<List<Map<String, dynamic>>> readList() async {
    try {
      final f = await _fichier();
      if (!await f.exists()) return const [];
      final raw = jsonDecode(await f.readAsString());
      final items = (raw is Map ? raw['items'] : null) as List?;
      return items
              ?.whereType<Map>()
              .map((e) => e.cast<String, dynamic>())
              .toList() ??
          const [];
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
  static Future<void> upsert(Map<String, dynamic> item) => _serialise(() async {
        try {
          final items = await readList();
          final i = items.indexWhere((m) => m['id'] == item['id']);
          if (i >= 0) {
            items[i] = item;
          } else {
            items.insert(0, item);
          }
          await _ecrire(
              {'savedAt': DateTime.now().toIso8601String(), 'items': items});
        } catch (_) {/* best effort */}
      });

  /// Transition optimiste d'une opération MISE EN FILE (hors-ligne) : l'écran
  /// doit montrer l'état réel du travail (boutons Clôturer/Suspendre après un
  /// démarrage hors réseau, etc.).
  static Future<void> patch(String id, Map<String, dynamic> champs) =>
      _serialise(() async {
        try {
          final items = await readList();
          final i = items.indexWhere((m) => m['id'] == id);
          if (i < 0) return;
          items[i] = {...items[i], ...champs};
          await _ecrire(
              {'savedAt': DateTime.now().toIso8601String(), 'items': items});
        } catch (_) {/* best effort */}
      });
}
