import 'package:geolocator/geolocator.dart';

/// Capture la position GPS pour géolocaliser les saisies terrain.
class LocationService {
  /// Retourne (latitude, longitude) ou null si indisponible/refusé.
  Future<({double lat, double lng})?> currentPosition() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) return null;

      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        return null;
      }

      // Position connue récente (instantanée), sinon nouvelle mesure avec timeout.
      final last = await Geolocator.getLastKnownPosition();
      if (last != null) return (lat: last.latitude, lng: last.longitude);

      final pos = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.medium,
        // Timeout : sur émulateur/sans fix GPS, on n'attend pas indéfiniment.
        timeLimit: const Duration(seconds: 8),
      );
      return (lat: pos.latitude, lng: pos.longitude);
    } catch (_) {
      // TimeoutException, GPS indisponible, permission refusée… → on enregistre sans GPS.
      return null;
    }
  }
}
