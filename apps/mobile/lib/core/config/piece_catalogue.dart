/// Pièce du catalogue de rechange, servie par /config (b51+ : avec l'id, la
/// catégorie et les synonymes). Le terrain CHOISIT dans cette liste : la pièce
/// part identifiée (pieceRefId), plus de texte libre à rapprocher.
class PieceCatalogue {
  final String id;
  final String code;
  final String libelle;
  final String unite;
  final String? categorie;
  final List<String> synonymes;

  const PieceCatalogue({
    required this.id,
    required this.code,
    required this.libelle,
    required this.unite,
    this.categorie,
    this.synonymes = const [],
  });

  static PieceCatalogue? fromJson(Object? e) {
    if (e is! Map || e['libelle'] == null) return null;
    return PieceCatalogue(
      id: e['id']?.toString() ?? '',
      code: e['code']?.toString() ?? '',
      libelle: e['libelle'].toString(),
      unite: e['unite']?.toString() ?? 'unité',
      categorie: e['categorie']?.toString(),
      synonymes: e['synonymes'] is List
          ? [for (final s in e['synonymes'] as List) s.toString()]
          : const [],
    );
  }

  /// Unité « continue » (litre, mètre, kg) : les quantités y sont plus grandes.
  bool get uniteContinue => const {'litre', 'mètre', 'metre', 'kg'}.contains(unite.toLowerCase());
}

/// Casse et accents ignorés : « Filtre à gasoil » ≈ « filtre a gasoil ».
String sansAccents(String s) {
  const de = 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿœæ';
  const vers = 'aaaaaaceeeeiiiinooooouuuuyyoa';
  final b = StringBuffer();
  for (final c in s.toLowerCase().split('')) {
    final i = de.indexOf(c);
    b.write(i >= 0 ? vers[i] : c);
  }
  return b.toString();
}

/// Mots d'une recherche ou d'un libellé (séparateurs retirés).
List<String> _mots(String s) =>
    sansAccents(s).split(RegExp(r'[^a-z0-9]+')).where((m) => m.isNotEmpty).toList();

/// Pièces correspondant à la recherche : TOUS les mots tapés doivent se
/// retrouver (en début de mot) dans le libellé, un synonyme ou le code. Les
/// pièces de la catégorie de l'équipement maintenu passent en premier, puis
/// l'ordre alphabétique.
List<PieceCatalogue> rechercherPieces(
  String requete,
  List<PieceCatalogue> catalogue, {
  String? categoriePrioritaire,
}) {
  final cherches = _mots(requete);
  bool correspond(PieceCatalogue p) {
    if (cherches.isEmpty) return true;
    final mots = <String>{
      ..._mots(p.libelle),
      for (final s in p.synonymes) ..._mots(s),
      ..._mots(p.code),
    };
    return cherches.every((c) => mots.any((m) => m.startsWith(c)));
  }

  final trouves = catalogue.where(correspond).toList();
  trouves.sort((a, b) {
    final pa = a.categorie == categoriePrioritaire ? 0 : 1;
    final pb = b.categorie == categoriePrioritaire ? 0 : 1;
    if (pa != pb) return pa - pb;
    return a.libelle.toLowerCase().compareTo(b.libelle.toLowerCase());
  });
  return trouves;
}

/// Seuil au-delà duquel une quantité demande confirmation (faute de frappe :
/// « 50 » filtres au lieu de « 5 »).
int seuilQuantiteInhabituelle(PieceCatalogue? p) => (p?.uniteContinue ?? false) ? 60 : 10;

/// Codes du KIT VIDANGE (migration 0074) : proposé quand une vidange est cochée.
const codesKitVidange = ['GE_HUILE_MOTEUR_15W40', 'GE_FILTRE_HUILE', 'GE_FILTRE_GASOIL', 'GE_FILTRE_AIR'];
