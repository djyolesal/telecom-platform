import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:telecom_mobile/core/constants/app_constants.dart';
import 'package:telecom_mobile/core/sync/photo_draft.dart';

/// Retour terrain : en prenant les photos APRÈS d'une clôture de maintenance,
/// « tout se réinitialise » et il faut recommencer, parfois plusieurs fois.
/// C'est Android qui détruit l'activité pendant que l'appareil photo est au
/// premier plan — l'état en mémoire disparaît. Ces tests verrouillent le
/// brouillon qui permet de retrouver les photos au lieu de tout refaire.
void main() {
  late Directory tmp;

  setUp(() async {
    tmp = await Directory.systemTemp.createTemp('photo_draft_test');
    Hive.init(tmp.path);
    await Hive.openBox(AppConstants.kSettingsBox);
  });

  tearDown(() async {
    await Hive.deleteFromDisk();
    if (tmp.existsSync()) tmp.deleteSync(recursive: true);
  });

  Future<String> fichier(String nom) async {
    final f = File('${tmp.path}/$nom');
    await f.writeAsBytes([0xFF, 0xD8, 0xFF]); // en-tête JPEG
    return f.path;
  }

  test('ce qui a été pris est retrouvé après la mort de l\'activité', () async {
    final a = await fichier('a.jpg');
    final b = await fichier('b.jpg');
    await PhotoDraft.ecrire('cloture:m1', [a, b]);

    // L'app redémarre : la liste en mémoire a disparu, le brouillon non.
    expect(PhotoDraft.lire('cloture:m1'), [a, b]);
  });

  test('deux maintenances ne se mélangent pas', () async {
    final a = await fichier('a.jpg');
    final b = await fichier('b.jpg');
    await PhotoDraft.ecrire('cloture:m1', [a]);
    await PhotoDraft.ecrire('cloture:m2', [b]);

    expect(PhotoDraft.lire('cloture:m1'), [a]);
    expect(PhotoDraft.lire('cloture:m2'), [b]);
  });

  test('un fichier disparu du disque est écarté, pas remonté', () async {
    final a = await fichier('a.jpg');
    final b = await fichier('b.jpg');
    await PhotoDraft.ecrire('cloture:m1', [a, b]);
    File(b).deleteSync(); // purge de l'OS, ménage manuel…

    // Mieux vaut une photo manquante — que le technicien reprendra — qu'un
    // envoi qui échoue sur un chemin mort.
    expect(PhotoDraft.lire('cloture:m1'), [a]);
  });

  test('la clôture acceptée efface le brouillon', () async {
    await PhotoDraft.ecrire('cloture:m1', [await fichier('a.jpg')]);
    await PhotoDraft.effacer('cloture:m1');
    expect(PhotoDraft.lire('cloture:m1'), isEmpty);
  });

  test('aucun brouillon = liste vide, jamais une erreur', () {
    expect(PhotoDraft.lire('cloture:jamais-vue'), isEmpty);
  });
}
