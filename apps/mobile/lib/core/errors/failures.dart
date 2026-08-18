import 'package:equatable/equatable.dart';

/// Échecs métier remontés à la couche présentation (sans détails techniques).
sealed class Failure extends Equatable {
  final String message;
  const Failure(this.message);
  @override
  List<Object?> get props => [message];
}

class ServerFailure extends Failure {
  const ServerFailure([super.message = 'Erreur serveur']);
}

class NetworkFailure extends Failure {
  const NetworkFailure([super.message = 'Hors ligne - action mise en file d\'attente']);
}

class AuthFailure extends Failure {
  const AuthFailure([super.message = 'Identifiants invalides']);
}

class ValidationFailure extends Failure {
  const ValidationFailure([super.message = 'Données invalides']);
}
