import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../core/errors/exceptions.dart';
import '../data/auth_repository.dart';
import '../domain/user.dart';

enum AuthStatus { unknown, authenticating, authenticated, unauthenticated, failure }

class AuthState extends Equatable {
  final AuthStatus status;
  final User? user;
  final String? message;
  final bool biometricAvailable;
  final bool biometricEnabled;

  const AuthState({
    this.status = AuthStatus.unknown,
    this.user,
    this.message,
    this.biometricAvailable = false,
    this.biometricEnabled = false,
  });

  AuthState copyWith({
    AuthStatus? status,
    User? user,
    String? message,
    bool? biometricAvailable,
    bool? biometricEnabled,
  }) {
    return AuthState(
      status: status ?? this.status,
      user: user ?? this.user,
      message: message,
      biometricAvailable: biometricAvailable ?? this.biometricAvailable,
      biometricEnabled: biometricEnabled ?? this.biometricEnabled,
    );
  }

  @override
  List<Object?> get props => [status, user, message, biometricAvailable, biometricEnabled];
}

class AuthCubit extends Cubit<AuthState> {
  final AuthRepository _repo;
  AuthCubit(this._repo) : super(const AuthState());

  /// Vérifie l'état de session au démarrage (et propose la biométrie).
  Future<void> bootstrap() async {
    final available = await _repo.biometricAvailable;
    final enabled = await _repo.biometricEnabled;
    final hasSession = await _repo.hasSession;

    if (!hasSession) {
      emit(state.copyWith(status: AuthStatus.unauthenticated, biometricAvailable: available, biometricEnabled: enabled));
      return;
    }

    final cached = await _repo.cachedUser();
    if (enabled && available) {
      // Session présente mais verrouillée → attente du déverrouillage biométrique
      emit(state.copyWith(
        status: AuthStatus.unauthenticated,
        user: cached,
        biometricAvailable: available,
        biometricEnabled: enabled,
      ));
      return;
    }

    emit(state.copyWith(
      status: cached != null ? AuthStatus.authenticated : AuthStatus.unauthenticated,
      user: cached,
      biometricAvailable: available,
      biometricEnabled: enabled,
    ));
  }

  Future<void> login(String email, String password) async {
    emit(state.copyWith(status: AuthStatus.authenticating, message: null));
    try {
      final user = await _repo.login(email, password);
      emit(state.copyWith(status: AuthStatus.authenticated, user: user));
    } on UnauthorizedException {
      emit(state.copyWith(status: AuthStatus.failure, message: 'Email ou mot de passe incorrect'));
    } on NetworkException {
      emit(state.copyWith(status: AuthStatus.failure, message: 'Pas de connexion — réessayez'));
    } on ServerException catch (e) {
      emit(state.copyWith(status: AuthStatus.failure, message: e.message));
    }
  }

  /// Déverrouillage par biométrie d'une session existante.
  Future<void> unlockWithBiometric() async {
    final ok = await _repo.authenticateBiometric();
    if (ok) {
      final user = state.user ?? await _repo.cachedUser();
      emit(state.copyWith(status: AuthStatus.authenticated, user: user));
    } else {
      emit(state.copyWith(status: AuthStatus.failure, message: 'Échec de l\'authentification biométrique'));
    }
  }

  Future<void> toggleBiometric(bool enabled) async {
    await _repo.setBiometricEnabled(enabled);
    emit(state.copyWith(biometricEnabled: enabled));
  }

  Future<void> logout() async {
    await _repo.logout();
    emit(const AuthState(status: AuthStatus.unauthenticated));
  }
}
