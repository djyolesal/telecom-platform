/// Relevé énergie (compteur CEET, gasoil GE, etc.).
class Releve {
  final String id;
  final String? siteCode;
  final String? siteNom;
  final DateTime? dateReleve;
  final String source;
  final double? consommationKwh;
  final double? volumeGasoilLitres;
  final double? heuresFonctGE;

  const Releve({
    required this.id,
    this.siteCode,
    this.siteNom,
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
      siteNom: site?['nom'] as String?,
      dateReleve: DateTime.tryParse(j['dateReleve']?.toString() ?? ''),
      source: j['source'] as String? ?? 'CEET',
      consommationKwh: _dn(j['consommationKwh']),
      volumeGasoilLitres: _dn(j['volumeGasoilLitres']),
      heuresFonctGE: _dn(j['heuresFonctGE']),
    );
  }
}

/// Détail complet d'un relevé énergie (avec la maintenance d'origine).
class ReleveDetail {
  final String id;
  final String? siteCode;
  final String? siteNom;
  final DateTime? dateReleve;
  final String source;
  final double? indexCompteur;
  final double? consommationKwh;
  final double? volumeGasoilLitres;
  final double? gasoilConsommeLitres;
  final double? heuresFonctGE;
  final double? puissanceKva;
  final double? coutEstime;
  final int? groupeNumero;
  final String? technicienNom;
  final String? observations;
  final String? maintenanceId;
  final String? maintenanceType;
  final String? maintenanceEquipement;

  const ReleveDetail({
    required this.id,
    this.siteCode,
    this.siteNom,
    this.dateReleve,
    required this.source,
    this.indexCompteur,
    this.consommationKwh,
    this.volumeGasoilLitres,
    this.gasoilConsommeLitres,
    this.heuresFonctGE,
    this.puissanceKva,
    this.coutEstime,
    this.groupeNumero,
    this.technicienNom,
    this.observations,
    this.maintenanceId,
    this.maintenanceType,
    this.maintenanceEquipement,
  });

  factory ReleveDetail.fromJson(Map<String, dynamic> j) {
    final site = j['site'] as Map<String, dynamic>?;
    final tech = j['technicien'] as Map<String, dynamic>?;
    final groupe = j['groupe'] as Map<String, dynamic>?;
    final m = j['maintenance'] as Map<String, dynamic>?;
    return ReleveDetail(
      id: j['id'] as String,
      siteCode: site?['code'] as String?,
      siteNom: site?['nom'] as String?,
      dateReleve: DateTime.tryParse(j['dateReleve']?.toString() ?? ''),
      source: j['source'] as String? ?? 'CEET',
      indexCompteur: Releve._dn(j['indexCompteur']),
      consommationKwh: Releve._dn(j['consommationKwh']),
      volumeGasoilLitres: Releve._dn(j['volumeGasoilLitres']),
      gasoilConsommeLitres: Releve._dn(j['gasoilConsommeLitres']),
      heuresFonctGE: Releve._dn(j['heuresFonctGE']),
      puissanceKva: Releve._dn(j['puissanceKva']),
      coutEstime: Releve._dn(j['coutEstime']),
      groupeNumero: (groupe?['numero'] as num?)?.toInt(),
      technicienNom: tech == null ? null : '${tech['prenom'] ?? ''} ${tech['nom'] ?? ''}'.trim(),
      observations: j['observations'] as String?,
      maintenanceId: m?['id'] as String?,
      maintenanceType: m?['type'] as String?,
      maintenanceEquipement: m?['equipement'] as String?,
    );
  }
}
