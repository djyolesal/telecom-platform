// Exceptions techniques levées par les couches data.

class ServerException implements Exception {
  final String message;
  final int? statusCode;
  const ServerException(this.message, {this.statusCode});
  @override
  String toString() => 'ServerException($statusCode): $message';
}

class NetworkException implements Exception {
  final String message;
  NetworkException([this.message = 'Pas de connexion réseau']);
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
