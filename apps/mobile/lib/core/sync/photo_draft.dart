import 'dart:io';
import 'package:hive_flutter/hive_flutter.dart';
import '../constants/app_constants.dart';

/// BROUILLON DE PHOTOS — survit à la mort de l'activité.
///
/// Retour terrain (clôture de maintenance) : en prenant les photos APRÈS,
/// l'application « se réinitialise » et les photos disparaissent, parfois
/// plusieurs fois de suite. C'est le comportement d'Android : pendant que
/// l'appareil photo est au premier plan, le système peut DÉTRUIRE l'activité
/// pour libérer de la mémoire. Au retour, l'app redémarre — la feuille de
/// clôture et sa liste en mémoire ont disparu, et tout est à refaire.
///
/// Le remède tient en deux temps, et les deux sont nécessaires :
///  1. chaque photo est recopiée AUSSITÔT en stockage durable (le cache
///     d'image_picker, lui, peut être purgé par l'OS) ;
///  2. la liste des chemins est écrite ICI, hors de l'état du widget, donc
///     relisible après un redémarrage complet de l'application.
class PhotoDraft {
  static Box get _box => Hive.box(AppConstants.kSettingsBox);
  static String _cle(String contexte) => 'photos_brouillon:$contexte';

  /// Chemins encore présents sur le disque. Un fichier disparu (purge, ménage
  /// manuel) est filtré : mieux vaut une photo manquante qu'un envoi en échec.
  static List<String> lire(String contexte) {
    final brut = _box.get(_cle(contexte));
    if (brut is! List) return [];
    return brut.cast<String>().where((p) => File(p).existsSync()).toList();
  }

  static Future<void> ecrire(String contexte, List<String> chemins) =>
      _box.put(_cle(contexte), chemins);

  /// À appeler une fois la clôture ACCEPTÉE : le brouillon n'a plus d'objet.
  /// Les fichiers, eux, restent au moteur de sync qui les supprimera après
  /// upload — les effacer ici perdrait une clôture mise en file hors-ligne.
  static Future<void> effacer(String contexte) => _box.delete(_cle(contexte));
}
