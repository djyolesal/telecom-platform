import 'dart:math' as math;

/// Conversion hauteur de gasoil (cm) → litres — MIROIR de
/// apps/api/src/utils/cuve.ts et apps/web/lib/cuve.ts (même logique, mêmes
/// priorités). Toute évolution doit être reportée dans les trois fichiers.
///
/// Priorités : barémage (>= 2 points, interpolation linéaire) > rectangulaire
/// (linéaire) > cylindre couché (segment circulaire — NON linéaire).
class PointBaremage {
  final double hauteurCm;
  final double litres;
  const PointBaremage(this.hauteurCm, this.litres);
}

class ConfigCuve {
  final String? formeCuve; // RECTANGULAIRE | CYLINDRE_COUCHE
  final double? longueurCm;
  final double? largeurCm;
  final double? hauteurCm;
  final double? diametreCm;
  final List<PointBaremage> baremage;

  const ConfigCuve({
    this.formeCuve,
    this.longueurCm,
    this.largeurCm,
    this.hauteurCm,
    this.diametreCm,
    this.baremage = const [],
  });

  factory ConfigCuve.fromJson(Map<String, dynamic> j) {
    double? dn(dynamic v) {
      if (v == null) return null;
      final n = v is num ? v.toDouble() : double.tryParse(v.toString());
      return (n != null && n.isFinite && n > 0) ? n : null;
    }

    final bareme = <PointBaremage>[];
    if (j['baremage'] is List) {
      for (final p in j['baremage'] as List) {
        if (p is Map) {
          // Une hauteur de 0 cm est un point de barème VALIDE (volume résiduel
          // à cuve vide sur un certificat de jaugeage) : on la garde avec un
          // test >= 0, à l'identique des moteurs api/web. `dn()` (> 0) reste
          // réservé aux dimensions géométriques, qui, elles, doivent être > 0.
          final hn = p['hauteurCm'] == null
              ? null
              : (p['hauteurCm'] is num
                  ? (p['hauteurCm'] as num).toDouble()
                  : double.tryParse(p['hauteurCm'].toString()));
          final h = (hn != null && hn.isFinite && hn >= 0) ? hn : null;
          final l = p['litres'] == null
              ? null
              : (p['litres'] is num
                  ? (p['litres'] as num).toDouble()
                  : double.tryParse(p['litres'].toString()));
          if (h != null && l != null && l >= 0) bareme.add(PointBaremage(h, l));
        }
      }
      bareme.sort((a, b) => a.hauteurCm.compareTo(b.hauteurCm));
    }
    return ConfigCuve(
      formeCuve: j['formeCuve'] as String?,
      longueurCm: dn(j['cuveLongueurCm']),
      largeurCm: dn(j['cuveLargeurCm']),
      hauteurCm: dn(j['cuveHauteurCm']),
      diametreCm: dn(j['cuveDiametreCm']),
      baremage: bareme,
    );
  }

  List<PointBaremage>? get _bareme => baremage.length >= 2 ? baremage : null;

  /// Hauteur interne maximale mesurable (cm), null si non configurée.
  double? get hauteurMaxCm {
    final b = _bareme;
    if (b != null) return b.last.hauteurCm;
    if (formeCuve == 'RECTANGULAIRE') return hauteurCm;
    if (formeCuve == 'CYLINDRE_COUCHE') return diametreCm;
    return null;
  }

  /// Litres pour une hauteur mesurée ; null = cuve non configurée.
  double? litresPourHauteur(double h) {
    if (!h.isFinite || h < 0) return null;

    final b = _bareme;
    if (b != null) {
      if (h <= b.first.hauteurCm) {
        // Sous le premier point : proportionnel depuis (0, 0).
        return b.first.hauteurCm > 0
            ? _arrondi(h / b.first.hauteurCm * b.first.litres)
            : b.first.litres;
      }
      if (h >= b.last.hauteurCm) return _arrondi(b.last.litres);
      for (var i = 1; i < b.length; i++) {
        if (h <= b[i].hauteurCm) {
          final a = b[i - 1];
          final t = (h - a.hauteurCm) / (b[i].hauteurCm - a.hauteurCm);
          return _arrondi(a.litres + t * (b[i].litres - a.litres));
        }
      }
    }

    if (formeCuve == 'RECTANGULAIRE') {
      final l0 = longueurCm, l1 = largeurCm, h0 = hauteurCm;
      if (l0 == null || l1 == null || h0 == null) return null;
      return _arrondi(l0 * l1 * math.min(h, h0) / 1000);
    }

    if (formeCuve == 'CYLINDRE_COUCHE') {
      final d = diametreCm, l0 = longueurCm;
      if (d == null || l0 == null) return null;
      final r = d / 2;
      final hb = math.min(math.max(h, 0.0), 2 * r);
      final aire = r * r * math.acos((r - hb) / r) -
          (r - hb) * math.sqrt(math.max(2 * r * hb - hb * hb, 0));
      return _arrondi(aire * l0 / 1000);
    }

    return null;
  }

  /// Volume à hauteur max (L) — la cuve est « calculable » si non null.
  double? get volumeMaxLitres {
    final max = hauteurMaxCm;
    return max == null ? null : litresPourHauteur(max);
  }

  bool get calculable => volumeMaxLitres != null;

  static double _arrondi(double l) => (l * 10).roundToDouble() / 10;
}
