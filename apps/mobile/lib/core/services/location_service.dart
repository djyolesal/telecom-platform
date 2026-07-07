import 'package:geolocator/geolocator.dart';

/// Position GPS avec sa précision estimée (rayon d'incertitude en mètres).
typedef GpsFix = ({double lat, double lng, double accuracyM});

/// Capture la position GPS pour géolocaliser les saisies terrain.
class LocationService {
  /// Service actif + permission accordée (demande si nécessaire).
  Future<bool> ensurePermission() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) return false;
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      return permission != LocationPermission.denied &&
          permission != LocationPermission.deniedForever;
    } catch (_) {
      return false;
    }
  }

  /// Flux de mesures GPS haute précision (pour affiner jusqu'à ~5 m avant de
  /// chercher le site). Appeler [ensurePermission] avant de s'abonner.
  Stream<GpsFix> preciseFixes() => Geolocator.getPositionStream(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.bestForNavigation),
      ).map((p) => (lat: p.latitude, lng: p.longitude, accuracyM: p.accuracy));

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

  /// Mesure GPS FRAÎCHE et précise (pas de position en cache) pour vérifier la
  /// présence sur site avant un démarrage/clôture. Retourne null si indisponible.
  Future<({double lat, double lng})?> freshPosition() async {
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
      final pos = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high,
        timeLimit: const Duration(seconds: 12),
      );
      return (lat: pos.latitude, lng: pos.longitude);
    } catch (_) {
      return null;
    }
  }

  /// Distance en mètres entre deux points GPS.
  static double distanceMeters(double lat1, double lng1, double lat2, double lng2) =>
      Geolocator.distanceBetween(lat1, lng1, lat2, lng2);
}
