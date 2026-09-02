import 'package:flutter/material.dart';
import '../config/app_config.dart';
import '../widgets/gps_refine_sheet.dart';
import 'location_service.dart';

/// Garde GPS commun à TOUTES les saisies géofencées (dépotage, démarrage/
/// reprise/clôture de maintenance, démarrage/clôture d'incident).
///
/// Né du cas ANYRONKOPE : un dépotage saisi avec une localisation RÉSEAU
/// (± ~340 m) partait en file et se faisait refuser par le serveur à chaque
/// rejeu — la position figée dans la saisie ne pouvait plus jamais être
/// corrigée. Le contrôle doit donc avoir lieu AVANT d'enregistrer :
///  - site non géolocalisé → capture silencieuse (le serveur ignore le
///    contrôle, on trace quand même la position si disponible) ;
///  - affinage GPS (feuille ~5 m visés), puis distance locale contre la
///    fiche du site (cache hors-ligne, rayon synchronisé via /config) ;
///  - hors rayon avec une précision PIRE que le rayon → le diagnostic est
///    « mesure inutilisable », pas « vous êtes loin » : le message dit
///    d'activer la localisation précise, pas de se rapprocher.
Future<({bool ok, double? lat, double? lng})> positionVerifiee(
  BuildContext context, {
  double? siteLat,
  double? siteLng,
  String? siteNom,
  required String action,
}) async {
  if (siteLat == null || siteLng == null) {
    final pos = await LocationService().freshPosition();
    return (ok: true, lat: pos?.lat, lng: pos?.lng);
  }
  final fix = await refineGpsPosition(context);
  if (!context.mounted) return (ok: false, lat: null, lng: null);
  if (fix == null) {
    await _dialogHorsSite(context, 'Position GPS indisponible',
        'Impossible de vérifier votre présence sur site pour $action. Activez la localisation (précision élevée) et réessayez.');
    return (ok: false, lat: null, lng: null);
  }
  final rayon = AppConfig.geofenceRadiusM;
  final dist =
      LocationService.distanceMeters(fix.lat, fix.lng, siteLat, siteLng);
  if (dist <= rayon) return (ok: true, lat: fix.lat, lng: fix.lng);

  // Hors rayon : deux causes très différentes, deux consignes différentes.
  final precisionInconnue = fix.accuracyM < 0;
  if (precisionInconnue || fix.accuracyM > rayon) {
    await _dialogHorsSite(
      context,
      'Précision GPS insuffisante',
      'Position obtenue à ± ${precisionInconnue ? '?' : fix.accuracyM.round().toString()} m : '
          'trop imprécise pour prouver votre présence sur ${siteNom ?? 'le site'} '
          '(rayon autorisé ${rayon.round()} m).\n'
          'Activez la localisation précise (GPS), placez-vous à découvert, puis réessayez.',
    );
  } else {
    await _dialogHorsSite(
      context,
      'Vous n\'êtes pas sur le site',
      'Vous êtes à ${dist.round()} m (± ${fix.accuracyM.round()} m) du site ${siteNom ?? ''}.\n'
          'Rapprochez-vous à moins de ${rayon.round()} m pour $action.',
    );
  }
  return (ok: false, lat: null, lng: null);
}

Future<void> _dialogHorsSite(
    BuildContext context, String title, String message) async {
  if (!context.mounted) return;
  await showDialog<void>(
    context: context,
    builder: (ctx) => AlertDialog(
      icon: const Icon(Icons.location_off, color: Colors.red, size: 32),
      title: Text(title),
      content: Text(message),
      actions: [
        TextButton(
            onPressed: () => Navigator.pop(ctx), child: const Text('Compris')),
      ],
    ),
  );
}
