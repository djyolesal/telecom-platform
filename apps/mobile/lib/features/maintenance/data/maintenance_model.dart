/// Maintenance (préventive/curative).
class Maintenance {
  final String id;
  final String? siteId;
  final String type;
  final String categorie;
  final String equipement;
  final String? description;
  final String statut;
  final DateTime? datePlanifiee;
  final DateTime? dateDebut;
  final DateTime? dateFin;
  final int? dureeMinutes;
  final String? siteCode;
  final String? technicien;

  const Maintenance({
    required this.id,
    this.siteId,
    required this.type,
    required this.categorie,
    required this.equipement,
    this.description,
    required this.statut,
    this.datePlanifiee,
    this.dateDebut,
    this.dateFin,
    this.dureeMinutes,
    this.siteCode,
    this.technicien,
  });

  factory Maintenance.fromJson(Map<String, dynamic> j) {
    final site = j['site'] as Map<String, dynamic>?;
    final tech = j['technicien'] as Map<String, dynamic>?;
    return Maintenance(
      id: j['id'] as String,
      siteId: j['siteId'] as String?,
      type: j['type'] as String,
      categorie: j['categorie'] as String,
      equipement: j['equipement'] as String,
      description: j['description'] as String?,
      statut: j['statut'] as String? ?? 'PLANIFIEE',
      datePlanifiee: DateTime.tryParse(j['datePlanifiee']?.toString() ?? ''),
      dateDebut: DateTime.tryParse(j['dateDebut']?.toString() ?? ''),
      dateFin: DateTime.tryParse(j['dateFin']?.toString() ?? ''),
      dureeMinutes: j['dureeMinutes'] as int?,
      siteCode: site?['code'] as String?,
      technicien: tech != null ? '${tech['prenom']} ${tech['nom']}' : null,
    );
  }
}
