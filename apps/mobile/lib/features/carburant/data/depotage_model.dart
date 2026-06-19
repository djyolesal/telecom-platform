/// Dépotage (livraison de gasoil).
class Depotage {
  final String id;
  final String? siteCode;
  final String? siteNom;
  final DateTime? dateDepotage;
  final double volumeLitres;
  final double? stockApresLitres;
  final String? fournisseur;
  final double? coutTotal;

  const Depotage({
    required this.id,
    this.siteCode,
    this.siteNom,
    this.dateDepotage,
    required this.volumeLitres,
    this.stockApresLitres,
    this.fournisseur,
    this.coutTotal,
  });

  static double _d(dynamic v) => v == null ? 0 : (v is num ? v.toDouble() : double.tryParse(v.toString()) ?? 0);
  static double? _dn(dynamic v) => v == null ? null : (v is num ? v.toDouble() : double.tryParse(v.toString()));

  factory Depotage.fromJson(Map<String, dynamic> j) {
    final site = j['site'] as Map<String, dynamic>?;
    return Depotage(
      id: j['id'] as String,
      siteCode: site?['code'] as String?,
      siteNom: site?['nom'] as String?,
      dateDepotage: DateTime.tryParse(j['dateDepotage']?.toString() ?? ''),
      volumeLitres: _d(j['volumeLitres']),
      stockApresLitres: _dn(j['stockApresLitres']),
      fournisseur: j['fournisseur'] as String?,
      coutTotal: _dn(j['coutTotal']),
    );
  }
}
