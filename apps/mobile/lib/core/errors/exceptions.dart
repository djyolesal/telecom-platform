// Exceptions techniques levées par les couches data.

class ServerException implements Exception {
  final String message;
  final int? statusCode;

  /// Avertissements de vraisemblance renvoyés par le serveur (422 avec
  /// `confirmationRequise`) : la saisie est inhabituelle et doit être confirmée
  /// explicitement (renvoi avec `confirmerVraisemblance: true`).
  final List<String> avertissements;

  const ServerException(this.message, {this.statusCode, this.avertissements = const []});

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
