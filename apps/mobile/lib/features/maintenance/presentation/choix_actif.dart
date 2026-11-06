import 'package:flutter/material.dart';

import '../../../core/config/piece_catalogue.dart';
import '../data/maintenance_model.dart';

/// Actifs correspondant à la recherche : TOUS les mots tapés doivent se
/// retrouver dans le libellé, le nom ou le code du site (« Dépôt » compris).
/// Casse et accents ignorés. Triés par emplacement, pour parcourir sans taper.
List<ActifLite> rechercherActifs(String requete, List<ActifLite> actifs) {
  final mots =
      sansAccents(requete).split(RegExp(r'\s+')).where((m) => m.isNotEmpty);
  final trouves = actifs.where((a) {
    final texte = sansAccents(
        '${a.libelleAffiche} ${a.emplacement} ${a.siteCode ?? ''}');
    return mots.every(texte.contains);
  }).toList();
  trouves.sort((a, b) => sansAccents('${a.emplacement} ${a.libelleAffiche}')
      .compareTo(sansAccents('${b.emplacement} ${b.libelleAffiche}')));
  return trouves;
}

/// Champ de choix d'un actif pour une installation, une désinstallation ou un
/// déplacement. Le parc compte des centaines d'actifs de même libellé : sans le
/// site et sans recherche, une liste déroulante ne permet pas de les distinguer.
class ActifPicker extends StatelessWidget {
  final String label;
  final List<ActifLite> actifs;
  final ActifLite? valeur;
  final bool chargement;
  final ValueChanged<ActifLite> onChanged;

  const ActifPicker({
    super.key,
    required this.label,
    required this.actifs,
    required this.valeur,
    required this.chargement,
    required this.onChanged,
  });

  Future<void> _ouvrir(BuildContext context, FormFieldState<String> field) async {
    final choisi = await showModalBottomSheet<ActifLite>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => _ChoixActifSheet(actifs: actifs),
    );
    if (choisi != null) {
      onChanged(choisi);
      // Efface le « Requis » d'un enregistrement précédent : l'erreur d'un
      // FormField ne disparaît pas seule quand la valeur arrive.
      field.reset();
    }
  }

  @override
  Widget build(BuildContext context) {
    final sansListe = actifs.isEmpty;
    return FormField<String>(
      validator: (_) => valeur == null ? 'Requis' : null,
      builder: (field) => InkWell(
        onTap: sansListe ? null : () => _ouvrir(context, field),
        child: InputDecorator(
          decoration: InputDecoration(
            labelText: label,
            errorText: field.errorText,
            suffixIcon: chargement
                ? const Padding(
                    padding: EdgeInsets.all(12),
                    child: SizedBox(
                        height: 16,
                        width: 16,
                        child: CircularProgressIndicator(strokeWidth: 2)))
                : const Icon(Icons.search),
          ),
          child: Text(
            valeur != null
                ? '${valeur!.libelleAffiche} - ${valeur!.emplacement}'
                : chargement
                    ? 'Chargement…'
                    : sansListe
                        ? 'Aucun actif disponible'
                        : 'Rechercher par actif ou nom de site…',
            overflow: TextOverflow.ellipsis,
            style: TextStyle(color: valeur != null ? null : Colors.grey.shade500),
          ),
        ),
      ),
    );
  }
}

class _ChoixActifSheet extends StatefulWidget {
  final List<ActifLite> actifs;
  const _ChoixActifSheet({required this.actifs});

  @override
  State<_ChoixActifSheet> createState() => _ChoixActifSheetState();
}

class _ChoixActifSheetState extends State<_ChoixActifSheet> {
  String _requete = '';

  @override
  Widget build(BuildContext context) {
    final resultats = rechercherActifs(_requete, widget.actifs);
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SizedBox(
        height: MediaQuery.of(context).size.height * 0.85,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: TextField(
                autofocus: true,
                onChanged: (v) => setState(() => _requete = v),
                decoration: const InputDecoration(
                  prefixIcon: Icon(Icons.search),
                  hintText: 'Actif ou nom de site…',
                ),
              ),
            ),
            Expanded(
              child: resultats.isEmpty
                  ? const Center(child: Text('Aucun actif ne correspond.'))
                  : ListView.separated(
                      itemCount: resultats.length,
                      separatorBuilder: (_, __) => const Divider(height: 1),
                      itemBuilder: (_, i) {
                        final a = resultats[i];
                        return ListTile(
                          dense: true,
                          title: Text(a.libelleAffiche,
                              style: const TextStyle(fontSize: 14)),
                          subtitle: Text(a.emplacement,
                              style: const TextStyle(fontSize: 12)),
                          onTap: () => Navigator.of(context).pop(a),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
