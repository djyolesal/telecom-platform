import 'package:flutter/material.dart';

/// Thème de l'application — couleurs alignées sur le portail web.
class AppColors {
  AppColors._();
  static const brand = Color(0xFF1B3F6B);
  static const brandLight = Color(0xFF2471A3);
  static const accent = Color(0xFF0E7C6B);
  static const critique = Color(0xFFC0392B);
  static const majeur = Color(0xFFE67E22);
  static const mineur = Color(0xFFF1C40F);
  static const informatif = Color(0xFF3498DB);
  static const bg = Color(0xFFF5F6F8);
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
      appBarTheme: const AppBarTheme(
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
          borderSide: const BorderSide(color: AppColors.brandLight, width: 2),
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
