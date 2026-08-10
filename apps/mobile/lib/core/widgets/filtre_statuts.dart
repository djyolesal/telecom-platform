import 'package:flutter/material.dart';

/// Rangée de puces de filtre (statut, période…) avec compteurs, à poser au-dessus
/// d'une liste. Filtrage LOCAL sur les éléments chargés : le comportement est
/// identique en ligne et hors-ligne, et le compteur dit ce qu'on va voir.
class FiltreStatuts extends StatelessWidget {
  /// Options ordonnées : valeur → libellé. La puce « Tous » est ajoutée d'office.
  final List<MapEntry<String, String>> options;

  /// Nombre d'éléments par valeur (les valeurs absentes affichent 0).
  final Map<String, int> comptes;

  /// Valeur sélectionnée (null = tous).
  final String? valeur;
  final ValueChanged<String?> onChanged;

  const FiltreStatuts({
    super.key,
    required this.options,
    required this.comptes,
    required this.valeur,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final total = comptes.values.fold<int>(0, (s, n) => s + n);
    Widget puce(String? val, String libelle, int n) {
      final selectionnee = valeur == val;
      return Padding(
        padding: const EdgeInsets.only(right: 6),
        child: ChoiceChip(
          label: Text('$libelle ($n)'),
          selected: selectionnee,
          onSelected: (_) => onChanged(selectionnee ? null : val),
          labelStyle: TextStyle(
            fontSize: 12,
            fontWeight: selectionnee ? FontWeight.w700 : FontWeight.w500,
          ),
          visualDensity: VisualDensity.compact,
          materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
        ),
      );
    }

    return SizedBox(
      height: 44,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        children: [
          puce(null, 'Tous', total),
          // Les statuts vides restent visibles (à 0) : une puce qui disparaît
          // ferait croire que le filtre a été perdu.
          for (final o in options) puce(o.key, o.value, comptes[o.key] ?? 0),
        ],
      ),
    );
  }
}
