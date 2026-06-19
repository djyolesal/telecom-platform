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
  final String? siteNom;
  final String? sitePowerConfig;
  final double? siteLatitude;
  final double? siteLongitude;
  final String? technicien;
  final String? prestataire;
  final List<String> photoUrls;
  final int photoCount;

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
    this.siteNom,
    this.sitePowerConfig,
    this.siteLatitude,
    this.siteLongitude,
    this.technicien,
    this.prestataire,
    this.photoUrls = const [],
    this.photoCount = 0,
  });

  /// Catégories considérées « passives » (relevés énergie requis à la clôture).
  static const passiveCategories = ['GE', 'BATTERIE', 'CLIMATISEUR', 'CABLE'];
  bool get isPassive => passiveCategories.contains(categorie);

  factory Maintenance.fromJson(Map<String, dynamic> j) {
    final site = j['site'] as Map<String, dynamic>?;
    final tech = j['technicien'] as Map<String, dynamic>?;
    final presta = j['prestataire'] as Map<String, dynamic>?;
    final photos = (j['photos'] as List?)
            ?.map((p) => (p as Map)['url']?.toString())
            .whereType<String>()
            .where((u) => u.isNotEmpty)
            .toList() ??
        const <String>[];
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
      siteNom: site?['nom'] as String?,
      sitePowerConfig: site?['powerConfig'] as String?,
      siteLatitude: site?['latitude'] == null ? null : double.tryParse(site!['latitude'].toString()),
      siteLongitude: site?['longitude'] == null ? null : double.tryParse(site!['longitude'].toString()),
      technicien: tech != null ? '${tech['prenom']} ${tech['nom']}' : null,
      prestataire: presta?['nom'] as String?,
      photoUrls: photos,
      // Liste : compteur via _count.photos ; détail : longueur du tableau photos.
      photoCount: (j['_count'] as Map?)?['photos'] as int? ?? photos.length,
    );
  }
}
