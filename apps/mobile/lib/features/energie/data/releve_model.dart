/// Relevé énergie (compteur CEET, gasoil GE, etc.).
class Releve {
  final String id;
  final String? siteCode;
  final DateTime? dateReleve;
  final String source;
  final double? consommationKwh;
  final double? volumeGasoilLitres;
  final double? heuresFonctGE;

  const Releve({
    required this.id,
    this.siteCode,
    this.dateReleve,
    required this.source,
    this.consommationKwh,
    this.volumeGasoilLitres,
    this.heuresFonctGE,
  });

  static double? _dn(dynamic v) => v == null ? null : (v is num ? v.toDouble() : double.tryParse(v.toString()));

  factory Releve.fromJson(Map<String, dynamic> j) {
    final site = j['site'] as Map<String, dynamic>?;
    return Releve(
      id: j['id'] as String,
      siteCode: site?['code'] as String?,
      dateReleve: DateTime.tryParse(j['dateReleve']?.toString() ?? ''),
      source: j['source'] as String? ?? 'CEET',
      consommationKwh: _dn(j['consommationKwh']),
      volumeGasoilLitres: _dn(j['volumeGasoilLitres']),
      heuresFonctGE: _dn(j['heuresFonctGE']),
    );
  }
}
