/// Incident terrain.
class Incident {
  final String id;
  final String? reference; // MNT/INC/DEP-année-numéro (lisible)
  final String? siteId;
  final String? siteCode;
  final String? siteNom;
  final String? region;
  final double? siteLatitude;
  final double? siteLongitude;
  final String type;
  final String severite;
  final String statut;
  final String description;
  final DateTime? dateOuverture;
  final DateTime? dateIntervention;
  final String? technicien;
  final String? causeProbable;
  final String? actionCorrective;
  final List<String> photoUrls;

  const Incident({
    required this.id,
    this.reference,
    this.siteId,
    this.siteCode,
    this.siteNom,
    this.region,
    this.siteLatitude,
    this.siteLongitude,
    required this.type,
    required this.severite,
    required this.statut,
    required this.description,
    this.dateOuverture,
    this.dateIntervention,
    this.technicien,
    this.causeProbable,
    this.actionCorrective,
    this.photoUrls = const [],
  });

  factory Incident.fromJson(Map<String, dynamic> j) {
    final site = j['site'] as Map<String, dynamic>?;
    final tech = j['technicien'] as Map<String, dynamic>?;
    final photos = (j['photos'] as List?)
            ?.map((p) => (p as Map<String, dynamic>)['url']?.toString() ?? '')
            .where((u) => u.isNotEmpty)
            .toList() ??
        const <String>[];
    return Incident(
      id: j['id'] as String,
      reference: j['reference'] as String?,
      siteId: j['siteId'] as String?,
      siteCode: site?['code'] as String?,
      siteNom: site?['nom'] as String?,
      region: site?['region'] as String?,
      // Prisma sérialise les Decimal en chaînes → parse tolérant.
      siteLatitude: double.tryParse(site?['latitude']?.toString() ?? ''),
      siteLongitude: double.tryParse(site?['longitude']?.toString() ?? ''),
      type: j['type'] as String,
      severite: j['severite'] as String,
      statut: j['statut'] as String? ?? 'OUVERT',
      description: j['description'] as String? ?? '',
      dateOuverture: DateTime.tryParse(j['dateOuverture']?.toString() ?? ''),
      dateIntervention:
          DateTime.tryParse(j['dateIntervention']?.toString() ?? ''),
      technicien: tech != null ? '${tech['prenom']} ${tech['nom']}' : null,
      causeProbable: j['causeProbable'] as String?,
      actionCorrective: j['actionCorrective'] as String?,
      photoUrls: photos,
    );
  }
}
