/// Dépotage (livraison de gasoil).
class Depotage {
  final String id;
  final String? siteCode;
  final String? siteNom;
  final DateTime? dateDepotage;
  final double volumeLitres;
  final double? stockApresLitres;
  final String? fournisseur;

  const Depotage({
    required this.id,
    this.siteCode,
    this.siteNom,
    this.dateDepotage,
    required this.volumeLitres,
    this.stockApresLitres,
    this.fournisseur,
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
