import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../core/widgets/common_widgets.dart';
import '../../../core/utils/formatters.dart';
import '../data/depotage_model.dart';
import '../data/bon_livraison_repository.dart';

const _moisLabels = ['', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

const _statutLigne = <String, Color>{
  'PREVU': Color(0xFF6B7280),
  'PARTIEL': Color(0xFFB45309),
  'LIVRE': Color(0xFF15803D),
  'ANNULE': Color(0xFFB91C1C),
};

/// Détail d'un chargement : son PLAN DE LIVRAISON (sites à servir et volumes)
/// et l'export PDF de ce plan, à présenter au dépôt ou à conserver.
class BlDetailScreen extends StatefulWidget {
  final String id;
  const BlDetailScreen({super.key, required this.id});

  @override
  State<BlDetailScreen> createState() => _BlDetailScreenState();
}

class _BlDetailScreenState extends State<BlDetailScreen> {
  late Future<BonLivraisonDetail> _future;
  bool _export = false;

  @override
  void initState() {
    super.initState();
    _charger();
  }

  void _charger() {
    _future = context.read<BonLivraisonRepository>().getBonLivraison(widget.id);
  }

  /// Télécharge le plan en PDF puis l'ouvre avec le lecteur du téléphone.
  Future<void> _exporterPdf(BonLivraisonDetail bl) async {
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _export = true);
    try {
      final chemin = await context.read<BonLivraisonRepository>().telechargerPlanPdf(bl.id, bl.numeroBL);
      final ouvert = await launchUrl(Uri.file(chemin), mode: LaunchMode.externalApplication);
      if (!ouvert && mounted) {
        // Aucun lecteur PDF installé : le fichier reste sur l'appareil.
        messenger.showSnackBar(SnackBar(content: Text('PDF enregistré : $chemin')));
      }
    } catch (e) {
      messenger.showSnackBar(SnackBar(
        content: Text('Export impossible : ${e is Exception ? 'vérifiez votre connexion' : e}'),
        backgroundColor: Colors.red,
      ));
    } finally {
      if (mounted) setState(() => _export = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Plan de livraison')),
      body: FutureBuilder<BonLivraisonDetail>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) return const LoadingView();
          if (snap.hasError) {
            return ErrorView(
              message: 'Chargement impossible (connexion requise).',
              onRetry: () => setState(_charger),
            );
          }
          final bl = snap.data!;
          return RefreshIndicator(
            onRefresh: () async => setState(_charger),
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                _Entete(bl: bl),
                const SizedBox(height: 16),
                // Sans plan défini, le PDF sortirait vide : bouton désactivé
                // plutôt qu'un document sans aucune ligne.
                FilledButton.icon(
                  onPressed: (_export || bl.lignes.isEmpty) ? null : () => _exporterPdf(bl),
                  icon: _export
                      ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : const Icon(Icons.picture_as_pdf),
                  label: Text(_export
                      ? 'Préparation du PDF…'
                      : bl.lignes.isEmpty
                          ? 'Plan à définir — export indisponible'
                          : 'Exporter le plan en PDF'),
                  style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
                ),
                const SizedBox(height: 20),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Sites à livrer', style: TextStyle(fontWeight: FontWeight.w700)),
                    Text('${bl.lignes.length}', style: TextStyle(color: Colors.grey.shade600)),
                  ],
                ),
                const SizedBox(height: 8),
                if (bl.lignes.isEmpty)
                  const EmptyView(
                    icon: Icons.map_outlined,
                    title: 'Plan non encore défini',
                    hint: 'Le manager répartira ce chargement entre les sites.',
                  )
                else
                  ...bl.lignes.map((l) => _CarteLigne(ligne: l)),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _Entete extends StatelessWidget {
  final BonLivraisonDetail bl;
  const _Entete({required this.bl});

  @override
  Widget build(BuildContext context) {
    final reste = (bl.volumeChargeLitres - bl.totalLivre).clamp(0, double.infinity);
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(bl.numeroBL, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            const SizedBox(height: 2),
            Text(
              '${bl.immatriculation} · ${_moisLabels[bl.mois.clamp(0, 12)]} ${bl.annee}'
              '${bl.bcNumero != null ? ' · BC ${bl.bcNumero}' : ''}',
              style: TextStyle(color: Colors.grey.shade600, fontSize: 13),
            ),
            const Divider(height: 20),
            _Ligne(label: 'Chargé au dépôt', valeur: fmtLitres(bl.volumeChargeLitres)),
            _Ligne(label: 'Déjà déposé', valeur: fmtLitres(bl.totalLivre)),
            _Ligne(label: 'Reste à livrer', valeur: fmtLitres(reste), fort: reste > 0),
            _Ligne(label: 'Date de chargement', valeur: fmtDate(bl.dateChargement)),
          ],
        ),
      ),
    );
  }
}

class _Ligne extends StatelessWidget {
  final String label;
  final String valeur;
  final bool fort;
  const _Ligne({required this.label, required this.valeur, this.fort = false});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: TextStyle(color: Colors.grey.shade600, fontSize: 13)),
          Text(valeur, style: TextStyle(fontWeight: fort ? FontWeight.w700 : FontWeight.w500)),
        ],
      ),
    );
  }
}

class _CarteLigne extends StatelessWidget {
  final LignePlanBL ligne;
  const _CarteLigne({required this.ligne});

  @override
  Widget build(BuildContext context) {
    final couleur = _statutLigne[ligne.statut] ?? Colors.grey;
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text('${ligne.siteCode} — ${ligne.siteNom}',
                      style: const TextStyle(fontWeight: FontWeight.w600)),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(color: couleur.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(20)),
                  child: Text(ligne.statut, style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: couleur)),
                ),
              ],
            ),
            if (ligne.region.isNotEmpty)
              Text(ligne.region, style: TextStyle(fontSize: 12, color: Colors.grey.shade500)),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(child: _Mini(label: 'Prévu', valeur: fmtLitres(ligne.volumePrevuLitres))),
                Expanded(child: _Mini(label: 'Livré', valeur: fmtLitres(ligne.volumeLivreReel))),
                Expanded(
                  child: _Mini(
                    label: 'Reste',
                    valeur: fmtLitres(ligne.restant),
                    couleur: ligne.restant > 0 ? Colors.orange.shade800 : Colors.green.shade700,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _Mini extends StatelessWidget {
  final String label;
  final String valeur;
  final Color? couleur;
  const _Mini({required this.label, required this.valeur, this.couleur});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: TextStyle(fontSize: 11, color: Colors.grey.shade500)),
        Text(valeur, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: couleur)),
      ],
    );
  }
}
