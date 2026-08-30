// Exceptions techniques levées par les couches data.

class ServerException implements Exception {
  final String message;
  final int? statusCode;

  /// Avertissements de vraisemblance renvoyés par le serveur (422 avec
  /// `confirmationRequise`) : la saisie est inhabituelle et doit être confirmée
  /// explicitement (renvoi avec `confirmerVraisemblance: true`).
  final List<String> avertissements;

  const ServerException(this.message,
      {this.statusCode, this.avertissements = const []});

  bool get confirmationRequise => avertissements.isNotEmpty;

  @override
  String toString() => 'ServerException($statusCode): $message';
}

class NetworkException implements Exception {
  final String message;
  const NetworkException([this.message = 'Pas de connexion réseau']);
  @override
  String toString() => 'NetworkException: $message';
}

class UnauthorizedException implements Exception {
  final String message;
  UnauthorizedException([this.message = 'Session expirée']);
}

class CacheException implements Exception {
  final String message;
  CacheException([this.message = 'Erreur de cache local']);
}

/// Message MÉTIER d'une exception, pour affichage à l'écran : jamais de
/// `toString()` brut (« NetworkException: … », « Instance of 'CacheException' »,
/// TypeError de parsing) face au technicien. Partagé par toutes les listes,
/// formulaires et écrans de détail.
String messageMetier(Object e, {String? parDefaut}) {
  if (e is ServerException) {
    return e.message; // rédigé par le serveur, en français
  }
  if (e is UnauthorizedException) {
    return 'Session expirée - reconnectez-vous puis réessayez.';
  }
  if (e is NetworkException) {
    return 'Connexion indisponible - réessayez une fois en ligne.';
  }
  return parDefaut ??
      'Une erreur est survenue - réessayez, puis prévenez votre superviseur si cela persiste.';
}
