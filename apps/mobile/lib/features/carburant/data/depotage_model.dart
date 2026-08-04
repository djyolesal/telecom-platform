/// Dépotage (livraison de gasoil).
class Depotage {
  final String id;
  final String? reference; // MNT/INC/DEP-année-numéro (lisible)
  final String? siteCode;
  final String? siteNom;
  final DateTime? dateDepotage;
  final double volumeLitres;
  final double? stockApresLitres;
  final String? fournisseur;
  final int photoCount;

  const Depotage({
    required this.id,
    this.reference,
    this.siteCode,
    this.siteNom,
    this.dateDepotage,
    required this.volumeLitres,
    this.stockApresLitres,
    this.fournisseur,
    this.photoCount = 0,
  });

  static double _d(dynamic v) => v == null ? 0 : (v is num ? v.toDouble() : double.tryParse(v.toString()) ?? 0);
  static double? _dn(dynamic v) => v == null ? null : (v is num ? v.toDouble() : double.tryParse(v.toString()));

  factory Depotage.fromJson(Map<String, dynamic> j) {
    final site = j['site'] as Map<String, dynamic>?;
    return Depotage(
      id: j['id'] as String,
      reference: j['reference'] as String?,
      siteCode: site?['code'] as String?,
      siteNom: site?['nom'] as String?,
      dateDepotage: DateTime.tryParse(j['dateDepotage']?.toString() ?? ''),
      volumeLitres: _d(j['volumeLitres']),
      stockApresLitres: _dn(j['stockApresLitres']),
      fournisseur: j['fournisseur'] as String?,
      photoCount: (j['photoCount'] as num?)?.toInt() ?? 0,
    );
  }
}

/// Détail complet d'un dépotage (réconciliation, heures GE, photos).
class DepotageDetail {
  final String id;
  final String? reference;
  final String? siteCode;
  final String? siteNom;
  final DateTime? dateDepotage;
  final double volumeLitres;
  final double? stockAvantLitres;
  final double? stockApresLitres;
  final double? volumeAnnonceLitres;
  final double? ecartLivraisonLitres;
  final double? gasoilAttenduLitres;
  final double? ecartConsoLitres;
  final String? analyseDepotage;
  final String? fournisseur;
  final String? numeroBonLivraison;
  final String? observations;
  final String? nomChauffeur;
  final String? nomAgentSecurite;
  final String? technicienNom;
  final List<DepotageHeureGE> heuresGE;
  final List<String> photoUrls;

  const DepotageDetail({
    required this.id,
    this.reference,
    this.siteCode,
    this.siteNom,
    this.dateDepotage,
    required this.volumeLitres,
    this.stockAvantLitres,
    this.stockApresLitres,
    this.volumeAnnonceLitres,
    this.ecartLivraisonLitres,
    this.gasoilAttenduLitres,
    this.ecartConsoLitres,
    this.analyseDepotage,
    this.fournisseur,
    this.numeroBonLivraison,
    this.observations,
    this.nomChauffeur,
    this.nomAgentSecurite,
    this.technicienNom,
    this.heuresGE = const [],
    this.photoUrls = const [],
  });

  factory DepotageDetail.fromJson(Map<String, dynamic> j) {
    final site = j['site'] as Map<String, dynamic>?;
    final tech = j['technicien'] as Map<String, dynamic>?;
    final heures = (j['heuresGE'] as List?) ?? const [];
    final photos = (j['photos'] as List?) ?? const [];
    return DepotageDetail(
      id: j['id'] as String,
      reference: j['reference'] as String?,
      siteCode: site?['code'] as String?,
      siteNom: site?['nom'] as String?,
      dateDepotage: DateTime.tryParse(j['dateDepotage']?.toString() ?? ''),
      volumeLitres: Depotage._d(j['volumeLitres']),
      stockAvantLitres: Depotage._dn(j['stockAvantLitres']),
      stockApresLitres: Depotage._dn(j['stockApresLitres']),
      volumeAnnonceLitres: Depotage._dn(j['volumeAnnonceLitres']),
      ecartLivraisonLitres: Depotage._dn(j['ecartLivraisonLitres']),
      gasoilAttenduLitres: Depotage._dn(j['gasoilAttenduLitres']),
      ecartConsoLitres: Depotage._dn(j['ecartConsoLitres']),
      analyseDepotage: j['analyseDepotage'] as String?,
      fournisseur: j['fournisseur'] as String?,
      numeroBonLivraison: j['numeroBonLivraison'] as String?,
      observations: j['observations'] as String?,
      nomChauffeur: j['nomChauffeur'] as String?,
      nomAgentSecurite: j['nomAgentSecurite'] as String?,
      technicienNom: tech == null ? null : '${tech['prenom'] ?? ''} ${tech['nom'] ?? ''}'.trim(),
      heuresGE: heures.map((e) => DepotageHeureGE.fromJson(e as Map<String, dynamic>)).toList(),
      photoUrls: photos.map((e) => (e as Map<String, dynamic>)['url'] as String?).whereType<String>().toList(),
    );
  }
}

/// Relevé d'index d'heures d'un GE rattaché à un dépotage.
class DepotageHeureGE {
  final double indexHeuresGE;
  final int? numero;
  final double? puissanceKva;
  final String? statut;

  const DepotageHeureGE({required this.indexHeuresGE, this.numero, this.puissanceKva, this.statut});

  factory DepotageHeureGE.fromJson(Map<String, dynamic> j) {
    final g = j['groupe'] as Map<String, dynamic>?;
    return DepotageHeureGE(
      indexHeuresGE: Depotage._d(j['indexHeuresGE']),
      numero: (g?['numero'] as num?)?.toInt(),
      puissanceKva: Depotage._dn(g?['puissanceKva']),
      statut: g?['statut'] as String?,
    );
  }
}

/// Groupe électrogène actif d'un site (pour le relevé d'heures au dépotage).
class GroupeGE {
  final String id;
  final int numero;
  final double puissanceKva;
  final String statut;

  const GroupeGE({required this.id, required this.numero, required this.puissanceKva, required this.statut});

  factory GroupeGE.fromJson(Map<String, dynamic> j) => GroupeGE(
        id: j['id'] as String,
        numero: (j['numero'] as num?)?.toInt() ?? 0,
        puissanceKva: Depotage._d(j['puissanceKva']),
        statut: j['statut'] as String? ?? 'GE_SECOURS',
      );
}

/// Bon de commande (vue allégée pour le transporteur qui crée un BL).
class BonCommandeLite {
  final String id;
  final String numero;
  final int annee;
  final int trimestre;
  final List<int> mois; // mois disponibles (volumes prévus)

  const BonCommandeLite({required this.id, required this.numero, required this.annee, required this.trimestre, required this.mois});

  factory BonCommandeLite.fromJson(Map<String, dynamic> j) {
    final vols = (j['volumesMensuels'] as List?) ?? const [];
    return BonCommandeLite(
      id: j['id'] as String,
      numero: j['numero'] as String,
      annee: (j['annee'] as num?)?.toInt() ?? 0,
      trimestre: (j['trimestre'] as num?)?.toInt() ?? 0,
      mois: vols.map((v) => (v['mois'] as num).toInt()).toList(),
    );
  }
}

/// Ligne d'un plan de livraison prévue pour un site (chaîne BC → BL → plan).
/// Permet au technicien de rattacher son dépotage à la livraison planifiée.
class PlanLigne {
  final String id;
  final double volumePrevuLitres;
  final double? volumeLivreLitres;
  final String statut;
  final String? numeroBL;
  final String? immatriculation;
  final DateTime? dateChargement;

  const PlanLigne({
    required this.id,
    required this.volumePrevuLitres,
    this.volumeLivreLitres,
    required this.statut,
    this.numeroBL,
    this.immatriculation,
    this.dateChargement,
  });

  double get restant => (volumePrevuLitres - (volumeLivreLitres ?? 0)).clamp(0, double.infinity);

  factory PlanLigne.fromJson(Map<String, dynamic> j) {
    final bl = j['bonLivraison'] as Map<String, dynamic>?;
    return PlanLigne(
      id: j['id'] as String,
      volumePrevuLitres: Depotage._d(j['volumePrevuLitres']),
      volumeLivreLitres: Depotage._dn(j['volumeLivreLitres']),
      statut: j['statut'] as String? ?? 'PREVU',
      numeroBL: bl?['numeroBL'] as String?,
      immatriculation: bl?['immatriculation'] as String?,
      dateChargement: DateTime.tryParse(bl?['dateChargement']?.toString() ?? ''),
    );
  }
}

/// Bon de livraison du transporteur — vue liste (« mes chargements »).
class BonLivraisonLite {
  final String id;
  final String numeroBL;
  final int mois;
  final int annee;
  final String immatriculation;
  final double volumeChargeLitres;
  final DateTime? dateChargement;
  final String statut;
  final int nbSites; // lignes du plan de livraison

  const BonLivraisonLite({
    required this.id,
    required this.numeroBL,
    required this.mois,
    required this.annee,
    required this.immatriculation,
    required this.volumeChargeLitres,
    this.dateChargement,
    required this.statut,
    this.nbSites = 0,
  });

  factory BonLivraisonLite.fromJson(Map<String, dynamic> j) => BonLivraisonLite(
        id: j['id'] as String,
        numeroBL: j['numeroBL'] as String? ?? '',
        mois: (j['mois'] as num?)?.toInt() ?? 0,
        annee: (j['annee'] as num?)?.toInt() ?? 0,
        immatriculation: j['immatriculation'] as String? ?? '',
        volumeChargeLitres: Depotage._d(j['volumeChargeLitres']),
        dateChargement: DateTime.tryParse(j['dateChargement']?.toString() ?? ''),
        statut: j['statut'] as String? ?? 'PLANIFIE',
        nbSites: ((j['lignes'] as List?)?.length) ?? (j['_count']?['lignes'] as num?)?.toInt() ?? 0,
      );
}

/// Une réception réelle sur un site (preuve de ce qui a été déposé).
class ReceptionSite {
  final DateTime? date;
  final double volumeLitres;
  const ReceptionSite({this.date, required this.volumeLitres});

  factory ReceptionSite.fromJson(Map<String, dynamic> j) => ReceptionSite(
        date: DateTime.tryParse(j['dateDepotage']?.toString() ?? ''),
        volumeLitres: Depotage._d(j['volumeLitres']),
      );
}

/// Une ligne du plan : le site à servir, le volume prévu/livré, ses coordonnées
/// (itinéraire) et le détail des réceptions déjà effectuées.
class LignePlanBL {
  final String siteCode;
  final String siteNom;
  final String region;
  final double? latitude;
  final double? longitude;
  final double volumePrevuLitres;
  final double volumeLivreReel;
  final String statut;
  final List<ReceptionSite> receptions;

  const LignePlanBL({
    required this.siteCode,
    required this.siteNom,
    required this.region,
    this.latitude,
    this.longitude,
    required this.volumePrevuLitres,
    required this.volumeLivreReel,
    required this.statut,
    this.receptions = const [],
  });

  double get restant => (volumePrevuLitres - volumeLivreReel).clamp(0, double.infinity);

  /// Un itinéraire n'est proposable que si le site est géolocalisé.
  bool get aItineraire => latitude != null && longitude != null;

  factory LignePlanBL.fromJson(Map<String, dynamic> j) {
    final s = j['site'] as Map<String, dynamic>?;
    return LignePlanBL(
      siteCode: s?['code'] as String? ?? '',
      siteNom: s?['nom'] as String? ?? '',
      region: s?['region'] as String? ?? '',
      latitude: Depotage._dn(s?['latitude']),
      longitude: Depotage._dn(s?['longitude']),
      volumePrevuLitres: Depotage._d(j['volumePrevuLitres']),
      volumeLivreReel: Depotage._d(j['volumeLivreReel']),
      statut: j['statut'] as String? ?? 'PREVU',
      receptions: ((j['depotages'] as List?) ?? const [])
          .map((e) => ReceptionSite.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }
}

/// Détail d'un bon de livraison : l'entête + son plan de livraison.
class BonLivraisonDetail {
  final String id;
  final String numeroBL;
  final int mois;
  final int annee;
  final String immatriculation;
  final double volumeChargeLitres;
  final DateTime? dateChargement;
  final String statut;
  final String? bcNumero;
  final List<LignePlanBL> lignes;
  final double sommeLignes;
  /// Chargement soldé : le reste en citerne a été ventilé (retour dépôt, perte,
  /// report). Sans cette information, le chauffeur voyait « reste à livrer »
  /// indéfiniment sur un camion déjà rentré au dépôt.
  final DateTime? dateCloture;

  const BonLivraisonDetail({
    required this.id,
    required this.numeroBL,
    required this.mois,
    required this.annee,
    required this.immatriculation,
    required this.volumeChargeLitres,
    this.dateChargement,
    required this.statut,
    this.bcNumero,
    this.lignes = const [],
    this.sommeLignes = 0,
    this.dateCloture,
  });

  bool get estClos => dateCloture != null;

  /// Volume réellement déposé sur l'ensemble des sites du plan.
  double get totalLivre => lignes.fold(0, (s, l) => s + l.volumeLivreReel);

  factory BonLivraisonDetail.fromJson(Map<String, dynamic> j) => BonLivraisonDetail(
        id: j['id'] as String,
        numeroBL: j['numeroBL'] as String? ?? '',
        mois: (j['mois'] as num?)?.toInt() ?? 0,
        annee: (j['annee'] as num?)?.toInt() ?? 0,
        immatriculation: j['immatriculation'] as String? ?? '',
        volumeChargeLitres: Depotage._d(j['volumeChargeLitres']),
        dateChargement: DateTime.tryParse(j['dateChargement']?.toString() ?? ''),
        statut: j['statut'] as String? ?? 'PLANIFIE',
        bcNumero: (j['bonCommande'] as Map<String, dynamic>?)?['numero'] as String?,
        lignes: ((j['lignes'] as List?) ?? const [])
            .map((e) => LignePlanBL.fromJson(e as Map<String, dynamic>))
            .toList(),
        sommeLignes: Depotage._d(j['sommeLignes']),
        dateCloture: DateTime.tryParse(j['dateCloture']?.toString() ?? ''),
      );
}
