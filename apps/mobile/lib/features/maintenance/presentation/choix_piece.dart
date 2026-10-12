import 'package:flutter/material.dart';

import '../../../core/config/app_config.dart';
import '../../../core/config/piece_catalogue.dart';

/// Pièce choisie à la clôture : une pièce DU CATALOGUE (identifiée, elle part
/// avec son id), ou un texte libre « hors catalogue » quand la pièce n'y est
/// pas - l'admin le rattachera ensuite depuis le portail.
class PieceChoisie {
  final PieceCatalogue? piece;
  final String nom;
  const PieceChoisie.catalogue(PieceCatalogue p)
      : piece = p,
        nom = '';
  const PieceChoisie.libre(this.nom) : piece = null;

  String get libelle => piece?.libelle ?? nom;
  String get unite => piece?.unite ?? 'unité';
  bool get horsCatalogue => piece == null;
}

/// Ouvre le sélecteur. [categorie] : celle de l'équipement maintenu, dont les
/// pièces passent en tête (GE pour une maintenance GE).
Future<PieceChoisie?> choisirPiece(BuildContext context, {String? categorie}) {
  return showModalBottomSheet<PieceChoisie>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (_) => _ChoixPieceSheet(categorie: categorie),
  );
}

class _ChoixPieceSheet extends StatefulWidget {
  final String? categorie;
  const _ChoixPieceSheet({this.categorie});

  @override
  State<_ChoixPieceSheet> createState() => _ChoixPieceSheetState();
}

class _ChoixPieceSheetState extends State<_ChoixPieceSheet> {
  final _recherche = TextEditingController();

  @override
  void dispose() {
    _recherche.dispose();
    super.dispose();
  }

  Future<void> _horsCatalogue() async {
    final nom = await showDialog<String>(
      context: context,
      builder: (_) => _DialogHorsCatalogue(initial: _recherche.text.trim()),
    );
    if (nom != null && mounted) Navigator.of(context).pop(PieceChoisie.libre(nom));
  }

  @override
  Widget build(BuildContext context) {
    final resultats = rechercherPieces(_recherche.text, AppConfig.pieces, categoriePrioritaire: widget.categorie);
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SizedBox(
        height: MediaQuery.of(context).size.height * 0.85,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 8, 8),
              child: Row(
                children: [
                  const Expanded(
                    child: Text('Choisir la pièce remplacée',
                        style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                  ),
                  IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.of(context).pop()),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: TextField(
                controller: _recherche,
                autofocus: true,
                onChanged: (_) => setState(() {}),
                decoration: const InputDecoration(
                  prefixIcon: Icon(Icons.search),
                  hintText: 'Rechercher : filtre gasoil, batterie 100…',
                ),
              ),
            ),
            const SizedBox(height: 8),
            Expanded(
              child: AppConfig.pieces.isEmpty
                  ? const Center(
                      child: Padding(
                        padding: EdgeInsets.all(24),
                        child: Text(
                          'Catalogue indisponible (première connexion hors réseau). '
                          'Utilisez « Pièce absente du catalogue ».',
                          textAlign: TextAlign.center,
                        ),
                      ),
                    )
                  : resultats.isEmpty
                      ? const Center(child: Text('Aucune pièce ne correspond.'))
                      : ListView.separated(
                          itemCount: resultats.length,
                          separatorBuilder: (_, __) => const Divider(height: 1),
                          itemBuilder: (_, i) {
                            final p = resultats[i];
                            return ListTile(
                              dense: true,
                              title: Text(p.libelle, style: const TextStyle(fontSize: 14)),
                              subtitle: Text(
                                [if (p.categorie != null) p.categorie!, 'compté en ${p.unite}'].join(' · '),
                                style: const TextStyle(fontSize: 12),
                              ),
                              onTap: () => Navigator.of(context).pop(PieceChoisie.catalogue(p)),
                            );
                          },
                        ),
            ),
            const Divider(height: 1),
            ListTile(
              leading: const Icon(Icons.edit_note),
              title: const Text('Pièce absente du catalogue'),
              subtitle: const Text('Saisie libre, vérifiée au bureau', style: TextStyle(fontSize: 12)),
              onTap: _horsCatalogue,
            ),
          ],
        ),
      ),
    );
  }
}

/// Saisie d'une pièce hors catalogue. Le dialogue POSSÈDE son contrôleur et le
/// libère dans son propre dispose() : le libérer juste après showDialog le
/// détruisait pendant l'animation de fermeture (« used after disposed »).
class _DialogHorsCatalogue extends StatefulWidget {
  final String initial;
  const _DialogHorsCatalogue({required this.initial});

  @override
  State<_DialogHorsCatalogue> createState() => _DialogHorsCatalogueState();
}

class _DialogHorsCatalogueState extends State<_DialogHorsCatalogue> {
  late final TextEditingController _ctrl = TextEditingController(text: widget.initial);

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  void _valider() {
    final t = _ctrl.text.trim();
    if (t.length >= 3) Navigator.of(context).pop(t);
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Pièce absente du catalogue'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Décrivez la pièce le plus précisément possible (type, référence, capacité). '
              'Elle sera vérifiée et rattachée au catalogue au bureau.',
              style: TextStyle(fontSize: 13),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _ctrl,
              autofocus: true,
              maxLength: 100,
              onSubmitted: (_) => _valider(),
              decoration: const InputDecoration(labelText: 'Pièce'),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Annuler')),
        TextButton(onPressed: _valider, child: const Text('Ajouter')),
      ],
    );
  }
}
