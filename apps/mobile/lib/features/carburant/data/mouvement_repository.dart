import '../../../core/sync/sync_service.dart';

/// MOUVEMENTS DE CARBURANT déclarés DEPUIS LE TERRAIN.
///
/// Un transfert entre sites ou une purge de cuve retire du gasoil du stock
/// attendu — donc de l'écart qui déclenche les alertes de vol. Déclarés au
/// bureau, ils étaient l'écriture la moins prouvée de toute la chaîne, alors
/// qu'un dépotage exige GPS, photos et signatures.
///
/// Déclarer depuis le site apporte la preuve. Mais la déclaration n'entre PAS
/// dans le stock : le serveur la crée `EN_ATTENTE` et un responsable la valide.
/// Le technicien constate et prouve ; il ne décide pas de faire disparaître du
/// carburant.
class MouvementRepository {
  final SyncService _sync;
  MouvementRepository(this._sync);

  List<Map<String, String>> _pieces(List<String> photoPaths, String? signaturePath) => [
        if (signaturePath != null)
          {'path': signaturePath, 'kind': 'signature', 'field': 'signaturePath'},
        for (final p in photoPaths) {'path': p, 'kind': 'photo'},
      ];

  /// PURGE : le gasoil sort de la cuve sans avoir été brûlé par le groupe.
  Future<SubmitResult> declarerPurge({
    required String siteId,
    required num volumeLitres,
    required String motif,
    double? latitude,
    double? longitude,
    List<String> photoPaths = const [],
    String? signaturePath,
  }) =>
      _sync.submit(
        endpoint: '/mouvements-carburant/purge',
        entityType: 'mouvement_purge',
        payload: {
          'siteId': siteId,
          'volumeLitres': volumeLitres,
          'motif': motif,
          'dateMouvement': DateTime.now().toUtc().toIso8601String(),
          if (latitude != null) 'latitude': latitude,
          if (longitude != null) 'longitude': longitude,
        },
        attachments: _pieces(photoPaths, signaturePath),
      );

  /// TRANSFERT : le gasoil quitte un site pour un autre. La preuve se prend au
  /// site de DÉPART — c'est de là que le carburant s'en va.
  Future<SubmitResult> declarerTransfert({
    required String siteSourceId,
    required String siteDestinationId,
    required num volumeLitres,
    required String motif,
    double? latitude,
    double? longitude,
    List<String> photoPaths = const [],
    String? signaturePath,
  }) =>
      _sync.submit(
        endpoint: '/mouvements-carburant/transfert',
        entityType: 'mouvement_transfert',
        payload: {
          'siteSourceId': siteSourceId,
          'siteDestinationId': siteDestinationId,
          'volumeLitres': volumeLitres,
          'motif': motif,
          'dateMouvement': DateTime.now().toUtc().toIso8601String(),
          if (latitude != null) 'latitude': latitude,
          if (longitude != null) 'longitude': longitude,
        },
        attachments: _pieces(photoPaths, signaturePath),
      );
}
