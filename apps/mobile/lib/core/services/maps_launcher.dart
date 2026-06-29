import 'package:url_launcher/url_launcher.dart';

/// Ouvre la navigation GPS native (Google/Apple Maps ou navigateur) vers un point.
/// Retourne false si aucune application n'a pu être lancée.
class MapsLauncher {
  /// Itinéraire turn-by-turn vers [lat],[lng] depuis la position courante.
  static Future<bool> directionsTo(double lat, double lng) async {
    // URL universelle Google Maps : ouvre l'app si installée, sinon le navigateur
    // (qui propose Google/Apple Maps). Fonctionne Android et iOS.
    final uri = Uri.parse('https://www.google.com/maps/dir/?api=1&destination=$lat,$lng&travelmode=driving');
    try {
      return await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      return false;
    }
  }
}
