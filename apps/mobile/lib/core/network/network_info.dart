import 'package:connectivity_plus/connectivity_plus.dart';

/// Indique l'état de connectivité réseau.
class NetworkInfo {
  final Connectivity _connectivity;
  NetworkInfo([Connectivity? connectivity]) : _connectivity = connectivity ?? Connectivity();

  Future<bool> get isConnected async {
    final result = await _connectivity.checkConnectivity();
    return _hasConnection(result);
  }

  /// Flux des changements de connectivité (true = en ligne).
  Stream<bool> get onStatusChange =>
      _connectivity.onConnectivityChanged.map(_hasConnection);

  bool _hasConnection(List<ConnectivityResult> results) =>
      results.any((r) => r != ConnectivityResult.none);
}
