import 'package:flutter/material.dart';

/// Marge standard d'un écran défilant : 16 sur les côtés, plus la hauteur de
/// la barre système en bas (navigation gestuelle) - sans elle, le dernier
/// élément de la liste (souvent le bouton d'action) finit sous la barre.
EdgeInsets paddingEcran(BuildContext context) =>
    EdgeInsets.fromLTRB(16, 16, 16, 24 + MediaQuery.of(context).padding.bottom);

/// Thème de l'application - couleurs alignées sur le portail web.
class AppColors {
  AppColors._();

  /// COULEURS DE MARQUE — variables, alignées sur le thème choisi au portail
  /// (Administration → Paramètres → Apparence) et reçues via /config. Non
  /// `const` pour cette raison : le terrain porte la même charte que le bureau.
  /// Les valeurs ci-dessous sont le thème par défaut ET le repli hors-ligne
  /// avant le premier /config — l'application doit rester lisible sans réseau.
  static Color brand = const Color(0xFF1B3F6B);
  static Color brandLight = const Color(0xFF2471A3);
  static Color accent = const Color(0xFF0E7C6B);

  /// ACCENT D'IDENTITÉ — la couleur qu'on reconnaît de loin. Réservée au logo :
  /// tenue à l'écart des états et des statuts, parce qu'une couleur de marque
  /// vive ressemble toujours à une alerte quand on la met partout.
  static Color brandAccent = const Color(0xFF2471A3);

  /// COULEURS DE STATUT — `const`, jamais thémables. Un incident critique doit
  /// rester rouge quelle que soit la charte : en plein soleil, sur un écran de
  /// téléphone, c'est la couleur qui porte l'information, pas le texte.
  static const critique = Color(0xFFC0392B);
  static const majeur = Color(0xFFE67E22);
  static const mineur = Color(0xFFF1C40F);
  static const informatif = Color(0xFF3498DB);
  static const bg = Color(0xFFF5F6F8);

  /// Incrémenté à chaque changement de charte : l'application se redessine.
  /// Sans lui, la config arrivant APRÈS le premier écran, le nouveau thème
  /// n'apparaîtrait qu'au redémarrage suivant.
  static final ValueNotifier<int> revision = ValueNotifier<int>(0);

  /// Applique une couleur reçue du serveur (« #1B3F6B »). Une valeur mal
  /// formée est ignorée : mieux vaut l'ancienne charte qu'un écran noir.
  static bool _appliquer(String? hexa, void Function(Color) poser) {
    if (hexa == null) return false;
    final m = RegExp(r'^#?([0-9A-Fa-f]{6})$').firstMatch(hexa.trim());
    if (m == null) return false;
    poser(Color(int.parse('FF${m.group(1)}', radix: 16)));
    return true;
  }

  static void appliquerTheme(Map<String, dynamic>? t) {
    if (t == null) return;
    var change = false;
    change |= _appliquer(t['brand'] as String?, (c) { if (brand != c) { brand = c; } else { return; } });
    change |= _appliquer(t['brandLight'] as String?, (c) { if (brandLight != c) { brandLight = c; } else { return; } });
    change |= _appliquer(t['accent'] as String?, (c) { if (accent != c) { accent = c; } else { return; } });
    change |= _appliquer(t['brandAccent'] as String?, (c) { if (brandAccent != c) { brandAccent = c; } else { return; } });
    if (change) revision.value++;
  }
}

class AppTheme {
  AppTheme._();

  static ThemeData get light {
    final base = ThemeData.light(useMaterial3: true);
    return base.copyWith(
      scaffoldBackgroundColor: AppColors.bg,
      colorScheme: ColorScheme.fromSeed(
        seedColor: AppColors.brand,
        primary: AppColors.brand,
        secondary: AppColors.accent,
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: AppColors.brand,
        foregroundColor: Colors.white,
        elevation: 0,
        centerTitle: false,
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        color: Colors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: BorderSide(color: Colors.grey.shade200),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: Colors.white,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: Colors.grey.shade300),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: Colors.grey.shade300),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          // Plus `const` : la couleur de marque est désormais variable.
          borderSide: BorderSide(color: AppColors.brandLight, width: 2),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: AppColors.brand,
          foregroundColor: Colors.white,
          // Sans quoi le fond marine s'applique aussi à l'état désactivé,
          // avec un libellé sombre illisible (ex. Démarrer/Clôturer pendant
          // l'opération, bouton de la feuille GPS avant la première mesure).
          disabledBackgroundColor: const Color(0xFFECEFF1),
          disabledForegroundColor: Colors.blueGrey.shade400,
          minimumSize: const Size.fromHeight(50),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
      ),
    );
  }

  /// Couleur associée à une sévérité d'incident.
  static Color severiteColor(String s) {
    switch (s) {
      case 'CRITIQUE':
        return AppColors.critique;
      case 'MAJEUR':
        return AppColors.majeur;
      case 'MINEUR':
        return AppColors.mineur;
      default:
        return AppColors.informatif;
    }
  }
}
