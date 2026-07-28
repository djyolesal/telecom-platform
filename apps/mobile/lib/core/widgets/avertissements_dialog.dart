import 'package:flutter/material.dart';

/// Dialogue de confirmation des saisies inhabituelles (contrôle de vraisemblance).
///
/// Affiché quand une valeur saisie contredit les données connues du site
/// (jauge > capacité de cuve, index qui recule, bond impossible…). Le technicien
/// peut retourner corriger, ou confirmer explicitement — la confirmation est
/// alors tracée côté serveur (observations + journal d'audit).
///
/// Retourne `true` si le technicien confirme sa saisie.
Future<bool> confirmerAvertissements(BuildContext context, List<String> avertissements) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Row(
        children: [
          Icon(Icons.warning_amber_rounded, color: Colors.orange.shade800),
          const SizedBox(width: 8),
          const Expanded(child: Text('Valeurs inhabituelles', style: TextStyle(fontSize: 17))),
        ],
      ),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final a in avertissements)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('• ', style: TextStyle(fontWeight: FontWeight.bold)),
                    Expanded(child: Text(a, style: const TextStyle(fontSize: 13))),
                  ],
                ),
              ),
            const SizedBox(height: 4),
            Text(
              'Vérifiez vos saisies. Si les valeurs sont exactes, confirmez : votre confirmation sera enregistrée.',
              style: TextStyle(fontSize: 12, color: Colors.grey.shade600),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Corriger')),
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: Colors.orange.shade800),
          onPressed: () => Navigator.pop(ctx, true),
          child: const Text('Je confirme mes valeurs'),
        ),
      ],
    ),
  );
  return ok == true;
}
