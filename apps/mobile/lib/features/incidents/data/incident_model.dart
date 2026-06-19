/// Incident terrain.
class Incident {
  final String id;
  final String? siteId;
  final String? siteCode;
  final String? siteNom;
  final String? region;
  final String type;
  final String severite;
  final String statut;
  final String description;
  final DateTime? dateOuverture;
  final String? technicien;
  final String? causeProbable;
  final String? actionCorrective;

  const Incident({
    required this.id,
    this.siteId,
    this.siteCode,
    this.siteNom,
    this.region,
    required this.type,
    required this.severite,
    required this.statut,
    required this.description,
    this.dateOuverture,
    this.technicien,
    this.causeProbable,
    this.actionCorrective,
  });

  factory Incident.fromJson(Map<String, dynamic> j) {
    final site = j['site'] as Map<String, dynamic>?;
    final tech = j['technicien'] as Map<String, dynamic>?;
    return Incident(
      id: j['id'] as String,
      siteId: j['siteId'] as String?,
      siteCode: site?['code'] as String?,
      siteNom: site?['nom'] as String?,
      region: site?['region'] as String?,
      type: j['type'] as String,
      severite: j['severite'] as String,
      statut: j['statut'] as String? ?? 'OUVERT',
      description: j['description'] as String? ?? '',
      dateOuverture: DateTime.tryParse(j['dateOuverture']?.toString() ?? ''),
      technicien: tech != null ? '${tech['prenom']} ${tech['nom']}' : null,
      causeProbable: j['causeProbable'] as String?,
      actionCorrective: j['actionCorrective'] as String?,
    );
  }
}
