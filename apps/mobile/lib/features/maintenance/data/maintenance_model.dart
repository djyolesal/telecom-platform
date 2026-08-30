import '../../../core/utils/cuve.dart';
import '../../../core/constants/enums.dart';

/// Item de la checklist contractuelle attendue à la clôture (référentiel
/// SERVEUR : le formulaire se dessine depuis cette liste — une évolution du
/// PV solaire ne demande pas de nouvelle version d'application).
class ItemChecklistAttendue {
  final String cle;
  final String libelle;
  final String? mesurePlaceholder; // non null = l'item attend une mesure
  const ItemChecklistAttendue(this.cle, this.libelle, this.mesurePlaceholder);

  static List<ItemChecklistAttendue> listeFromJson(dynamic j) {
    if (j is! List) return const [];
    return [
      for (final e in j)
        if (e is Map)
          ItemChecklistAttendue(
            e['cle']?.toString() ?? '',
            e['libelle']?.toString() ?? '',
            e['mesure'] is Map
                ? (e['mesure']['placeholder']?.toString())
                : null,
          ),
    ];
  }
}

/// Groupe électrogène d'un site (pour la saisie des index horaires par GE).
class GroupeGE {
  final String id;
  final int numero;

  /// Index horaire relevé à la dernière vidange confirmée (null = jamais enregistrée).
  final double? indexDerniereVidange;
  const GroupeGE(
      {required this.id, required this.numero, this.indexDerniereVidange});
  factory GroupeGE.fromJson(Map<String, dynamic> j) => GroupeGE(
        id: j['id'] as String,
        numero: (j['numero'] as num?)?.toInt() ?? 1,
        // Prisma sérialise les Decimal en chaîne.
        indexDerniereVidange:
            double.tryParse(j['indexHeuresDerniereVidange']?.toString() ?? ''),
      );
}

/// Maintenance (préventive/curative).
class Maintenance {
  final String id;
  final String? reference; // MNT/INC/DEP-année-numéro (lisible)
  final int dureeSuspendueMinutes; // pauses (urgences ailleurs) déjà décomptées
  final String? motifSuspension;
  final String? siteId;
  final String type;
  final String categorie;
  final String equipement;
  final String
      natureTravaux; // ENTRETIEN / INSTALLATION / DESINSTALLATION / DEPLACEMENT
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
  final String? analyseEnergie;
  final List<GroupeGE> siteGroupes;
  final List<String> photoUrls;

  /// Phases alignées sur photoUrls : 'AVANT' / 'APRES' / null (photo historique).
  final List<String?> photoPhases;
  final int photoCount;

  /// Vrai si la clôture exige les relevés énergie (calculé par l'API selon la tâche).
  final bool requiresEnergie;

  /// Dernières valeurs connues du site (détail uniquement) : repères affichés
  /// sous les champs de saisie + pré-contrôle de vraisemblance avant envoi.
  final ContexteSaisie? contexteSaisie;
  final List<ItemChecklistAttendue> checklistAttendue;

  const Maintenance({
    required this.id,
    this.reference,
    this.dureeSuspendueMinutes = 0,
    this.motifSuspension,
    this.siteId,
    required this.type,
    required this.categorie,
    required this.equipement,
    this.natureTravaux = 'ENTRETIEN',
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
    this.analyseEnergie,
    this.siteGroupes = const [],
    this.photoUrls = const [],
    this.photoPhases = const [],
    this.photoCount = 0,
    this.requiresEnergie = false,
    this.contexteSaisie,
    this.checklistAttendue = const [],
  });

  /// Catégories considérées « passives » (relevés énergie requis à la clôture).
  static const passiveCategories = ['GE', 'BATTERIE', 'CLIMATISEUR', 'CABLE'];
  bool get isPassive => passiveCategories.contains(categorie);

  factory Maintenance.fromJson(Map<String, dynamic> j) {
    final site = j['site'] as Map<String, dynamic>?;
    final tech = j['technicien'] as Map<String, dynamic>?;
    final presta = j['prestataire'] as Map<String, dynamic>?;
    final groupes = (site?['groupes'] as List?)
            ?.map((g) => GroupeGE.fromJson(g as Map<String, dynamic>))
            .toList() ??
        const <GroupeGE>[];
    final brutesPhotos = (j['photos'] as List?)
            ?.whereType<Map>()
            .where((p) => (p['url']?.toString() ?? '').isNotEmpty)
            .toList() ??
        const <Map>[];
    final photos = brutesPhotos.map((p) => p['url'].toString()).toList();
    final phases = brutesPhotos.map((p) => p['phase']?.toString()).toList();
    return Maintenance(
      id: j['id'] as String,
      reference: j['reference'] as String?,
      dureeSuspendueMinutes: (j['dureeSuspendueMinutes'] as num?)?.toInt() ?? 0,
      motifSuspension: j['motifSuspension'] as String?,
      siteId: j['siteId'] as String?,
      type: j['type'] as String,
      categorie: j['categorie'] as String,
      equipement: j['equipement'] as String,
      natureTravaux: j['natureTravaux'] as String? ?? 'ENTRETIEN',
      description: j['description'] as String?,
      statut: j['statut'] as String? ?? 'PLANIFIEE',
      datePlanifiee: DateTime.tryParse(j['datePlanifiee']?.toString() ?? ''),
      dateDebut: DateTime.tryParse(j['dateDebut']?.toString() ?? ''),
      dateFin: DateTime.tryParse(j['dateFin']?.toString() ?? ''),
      dureeMinutes: j['dureeMinutes'] as int?,
      siteCode: site?['code'] as String?,
      siteNom: site?['nom'] as String?,
      sitePowerConfig: site?['powerConfig'] as String?,
      siteLatitude: site?['latitude'] == null
          ? null
          : double.tryParse(site!['latitude'].toString()),
      siteLongitude: site?['longitude'] == null
          ? null
          : double.tryParse(site!['longitude'].toString()),
      technicien: tech != null ? '${tech['prenom']} ${tech['nom']}' : null,
      prestataire: presta?['nom'] as String?,
      analyseEnergie: j['analyseEnergie'] as String?,
      siteGroupes: groupes,
      photoUrls: photos,
      photoPhases: phases,
      // Liste : compteur via _count.photos ; détail : longueur du tableau photos.
      photoCount: (j['_count'] as Map?)?['photos'] as int? ?? photos.length,
      // Détail : fourni par l'API ; repli aligné sur la règle serveur si absent (liste) :
      // jamais de relevé pour un travail de cycle de vie.
      requiresEnergie: (j['requiresEnergieReleve'] as bool?) ??
          ((j['natureTravaux'] as String? ?? 'ENTRETIEN') == 'ENTRETIEN' &&
              passiveCategories.contains(j['categorie'] as String)),
      checklistAttendue:
          ItemChecklistAttendue.listeFromJson(j['checklistAttendue']),
      contexteSaisie: j['contexteSaisie'] is Map<String, dynamic>
          ? ContexteSaisie.fromJson(j['contexteSaisie'] as Map<String, dynamic>)
          : null,
    );
  }
}

/// Dernière valeur connue d'un compteur/niveau, avec sa date de relevé.
class ValeurConnue {
  final double valeur;
  final DateTime? date;
  const ValeurConnue({required this.valeur, this.date});

  static ValeurConnue? fromJson(dynamic j) {
    if (j is! Map) return null;
    final v = double.tryParse(j['valeur']?.toString() ?? '');
    if (v == null) return null;
    return ValeurConnue(
        valeur: v, date: DateTime.tryParse(j['date']?.toString() ?? ''));
  }
}

/// Dernières valeurs connues du site, fournies par l'API avec le détail d'une
/// maintenance : repères sous les champs de saisie + pré-contrôle de
/// vraisemblance AVANT mise en file hors-ligne.
class ContexteSaisie {
  final double? cuveVolumeLitres;
  final ValeurConnue? dernierNiveauCuve;
  final ValeurConnue? dernierIndexCeet;

  /// Dernier index horaire connu, par id de groupe électrogène.
  final Map<String, ValeurConnue> dernierIndexGE;

  /// Cas mono-GE sans groupe déclaré.
  final ValeurConnue? dernierIndexGEMono;
  final double maxHeuresGEParJour;
  final double margeCuvePct;

  /// Config de conversion hauteur → litres de la cuve du site (null si le
  /// serveur ne l'a pas fournie — anciens caches).
  final ConfigCuve? cuve;

  const ContexteSaisie({
    this.cuveVolumeLitres,
    this.dernierNiveauCuve,
    this.dernierIndexCeet,
    this.dernierIndexGE = const {},
    this.dernierIndexGEMono,
    this.maxHeuresGEParJour = 24,
    this.margeCuvePct = 2,
    this.cuve,
  });

  factory ContexteSaisie.fromJson(Map<String, dynamic> j) {
    final parGE = <String, ValeurConnue>{};
    (j['dernierIndexGE'] as Map?)?.forEach((k, v) {
      final vc = ValeurConnue.fromJson(v);
      if (vc != null) parGE[k.toString()] = vc;
    });
    return ContexteSaisie(
      cuveVolumeLitres:
          double.tryParse(j['cuveVolumeLitres']?.toString() ?? ''),
      dernierNiveauCuve: ValeurConnue.fromJson(j['dernierNiveauCuve']),
      dernierIndexCeet: ValeurConnue.fromJson(j['dernierIndexCeet']),
      dernierIndexGE: parGE,
      dernierIndexGEMono: ValeurConnue.fromJson(j['dernierIndexGEMono']),
      maxHeuresGEParJour:
          double.tryParse(j['maxHeuresGEParJour']?.toString() ?? '') ?? 24,
      margeCuvePct: double.tryParse(j['margeCuvePct']?.toString() ?? '') ?? 2,
      cuve: j['cuve'] is Map<String, dynamic>
          ? ConfigCuve.fromJson(j['cuve'] as Map<String, dynamic>)
          : null,
    );
  }
}

/// Actif (vue allégée) pour le choix lors d'un travail de cycle de vie.
class ActifLite {
  final String id;
  final String actifType; // 'GE' | 'BATTERIE' | 'CLIMATISEUR'
  final String categorie;
  final String? libelle;
  final String? siteId;
  final String? siteCode;

  const ActifLite(
      {required this.id,
      required this.actifType,
      required this.categorie,
      this.libelle,
      this.siteId,
      this.siteCode});

  factory ActifLite.fromJson(Map<String, dynamic> j) {
    final site = j['site'] as Map<String, dynamic>?;
    return ActifLite(
      id: j['id'] as String,
      actifType:
          j['actifType'] as String? ?? (j['categorie'] as String? ?? 'GE'),
      categorie: j['categorie'] as String? ?? 'GE',
      libelle: j['libelle'] as String?,
      siteId: j['siteId'] as String?,
      siteCode: site?['code'] as String?,
    );
  }

  String get display =>
      // Jamais le code de catégorie brut dans le sélecteur : libellé traduit
      // en repli quand l'API ne fournit pas de libellé d'actif.
      '${libelle ?? kCategorieEquipement[categorie] ?? categorie}${siteId != null ? '' : ' - Dépôt'}';
}
