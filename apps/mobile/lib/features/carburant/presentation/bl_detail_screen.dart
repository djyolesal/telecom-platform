import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../core/services/maps_launcher.dart';
import '../../../core/constants/enums.dart';
import '../../../core/widgets/common_widgets.dart';
import '../../../core/utils/formatters.dart';
import '../data/depotage_model.dart';
import '../data/bon_livraison_repository.dart';
import '../../../core/theme/app_theme.dart';

const _moisLabels = [
  '',
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre'
];

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
      final chemin = await context
          .read<BonLivraisonRepository>()
          .telechargerPlanPdf(bl.id, bl.numeroBL);
      final ouvert = await launchUrl(Uri.file(chemin),
          mode: LaunchMode.externalApplication);
      if (!ouvert && mounted) {
        // Aucun lecteur PDF installé : le fichier reste sur l'appareil.
        messenger
            .showSnackBar(SnackBar(content: Text('PDF enregistré : $chemin')));
      }
    } catch (e) {
      messenger.showSnackBar(SnackBar(
        content: Text(
            'Export impossible : ${e is Exception ? 'vérifiez votre connexion' : e}'),
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
          if (snap.connectionState == ConnectionState.waiting) {
            return const LoadingView();
          }
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
              padding: paddingEcran(context),
              children: [
                _Entete(bl: bl),
                const SizedBox(height: 16),
                // Sans plan défini, le PDF sortirait vide : bouton désactivé
                // plutôt qu'un document sans aucune ligne.
                FilledButton.icon(
                  onPressed: (_export || bl.lignes.isEmpty)
                      ? null
                      : () => _exporterPdf(bl),
                  icon: _export
                      ? const SizedBox(
                          height: 18,
                          width: 18,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: Colors.white))
                      : const Icon(Icons.picture_as_pdf),
                  label: Text(_export
                      ? 'Préparation du PDF…'
                      : bl.lignes.isEmpty
                          ? 'Plan à définir - export indisponible'
                          : 'Exporter le plan en PDF'),
                  style: FilledButton.styleFrom(
                      minimumSize: const Size.fromHeight(48)),
                ),
                const SizedBox(height: 20),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Sites à livrer',
                        style: TextStyle(fontWeight: FontWeight.w700)),
                    Text('${bl.lignes.length}',
                        style: TextStyle(color: Colors.grey.shade600)),
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
    final reste =
        (bl.volumeChargeLitres - bl.totalLivre).clamp(0, double.infinity);
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(bl.numeroBL,
                style:
                    const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            const SizedBox(height: 2),
            Text(
              '${bl.immatriculation} · ${_moisLabels[bl.mois.clamp(0, 12)]} ${bl.annee}'
              '${bl.bcNumero != null ? ' · BC ${bl.bcNumero}' : ''}',
              style: TextStyle(color: Colors.grey.shade600, fontSize: 13),
            ),
            const Divider(height: 20),
            _Ligne(
                label: 'Chargé au dépôt',
                valeur: fmtLitres(bl.volumeChargeLitres)),
            _Ligne(label: 'Déjà déposé', valeur: fmtLitres(bl.totalLivre)),
            _Ligne(
              label: bl.estClos ? 'Reste soldé à la clôture' : 'Reste à livrer',
              valeur: fmtLitres(reste),
              fort: reste > 0 && !bl.estClos,
            ),
            _Ligne(
                label: 'Date de chargement',
                valeur: fmtDate(bl.dateChargement)),
            if (bl.estClos)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                      color: const Color(0xFF15803D).withValues(alpha: 0.10),
                      borderRadius: BorderRadius.circular(8)),
                  child: Text(
                    'Chargement clôturé le ${fmtDate(bl.dateCloture)} - reste ventilé, plus rien à livrer.',
                    style: const TextStyle(
                        fontSize: 12,
                        color: Color(0xFF15803D),
                        fontWeight: FontWeight.w600),
                  ),
                ),
              ),
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
          Text(label,
              style: TextStyle(color: Colors.grey.shade600, fontSize: 13)),
          Text(valeur,
              style: TextStyle(
                  fontWeight: fort ? FontWeight.w700 : FontWeight.w500)),
        ],
      ),
    );
  }
}

class _CarteLigne extends StatefulWidget {
  final LignePlanBL ligne;
  const _CarteLigne({required this.ligne});

  @override
  State<_CarteLigne> createState() => _CarteLigneState();
}

class _CarteLigneState extends State<_CarteLigne> {
  bool _receptionsOuvertes = false;

  /// Ouvre la navigation vers le site (le chauffeur doit le trouver).
  Future<void> _itineraire() async {
    final l = widget.ligne;
    final ok = await MapsLauncher.directionsTo(l.latitude!, l.longitude!);
    if (!ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('Aucune application de navigation disponible.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final ligne = widget.ligne;
    final couleur = _statutLigne[ligne.statut] ?? Colors.grey;
    final nb = ligne.receptions.length;
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
                  child: Text(ligne.siteNom,
                      style: const TextStyle(fontWeight: FontWeight.w600)),
                ),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                      color: couleur.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(20)),
                  child: Text(
                      kStatutLigneLivraison[ligne.statut] ?? ligne.statut,
                      style: TextStyle(
                          fontSize: 10.5,
                          fontWeight: FontWeight.w700,
                          color: couleur)),
                ),
              ],
            ),
            if (ligne.region.isNotEmpty)
              Text(ligne.region,
                  style: TextStyle(fontSize: 12, color: Colors.grey.shade500)),
            if (ligne.pickup)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                      color: Colors.orange.shade50,
                      border: Border.all(color: Colors.orange.shade200),
                      borderRadius: BorderRadius.circular(20)),
                  child: Row(mainAxisSize: MainAxisSize.min, children: [
                    Icon(Icons.local_shipping,
                        size: 13, color: Colors.orange.shade800),
                    const SizedBox(width: 4),
                    Text('Pickup — camion citerne sans accès',
                        style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                            color: Colors.orange.shade800)),
                  ]),
                ),
              ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                    child: _Mini(
                        label: 'Prévu',
                        valeur: fmtLitres(ligne.volumePrevuLitres))),
                Expanded(
                    child: _Mini(
                        label: 'Livré',
                        valeur: fmtLitres(ligne.volumeLivreReel))),
                Expanded(
                  child: _Mini(
                    label: 'Reste',
                    valeur: fmtLitres(ligne.restant),
                    couleur: ligne.restant > 0
                        ? Colors.orange.shade800
                        : Colors.green.shade700,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                // Itinéraire : seulement si le site est géolocalisé.
                if (ligne.aItineraire)
                  TextButton.icon(
                    onPressed: _itineraire,
                    icon: const Icon(Icons.navigation_outlined, size: 16),
                    label: const Text('Itinéraire'),
                    style: TextButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                        minimumSize: Size.zero),
                  ),
                const Spacer(),
                // Réceptions réelles : la preuve de ce qui a été déposé ici.
                if (nb > 0)
                  TextButton(
                    onPressed: () => setState(
                        () => _receptionsOuvertes = !_receptionsOuvertes),
                    style: TextButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                        minimumSize: Size.zero),
                    child: Text(_receptionsOuvertes
                        ? 'Masquer'
                        : '$nb réception${nb > 1 ? 's' : ''}'),
                  ),
              ],
            ),
            if (_receptionsOuvertes && nb > 0) ...[
              const Divider(height: 12),
              ...ligne.receptions.map((r) => Padding(
                    padding: const EdgeInsets.symmetric(vertical: 2),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(fmtDate(r.date),
                            style: const TextStyle(fontSize: 12.5)),
                        Text(fmtLitres(r.volumeLitres),
                            style: const TextStyle(
                                fontSize: 12.5, fontWeight: FontWeight.w600)),
                      ],
                    ),
                  )),
            ],
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
        Text(label,
            style: TextStyle(fontSize: 11, color: Colors.grey.shade500)),
        Text(valeur,
            style: TextStyle(
                fontSize: 13, fontWeight: FontWeight.w600, color: couleur)),
      ],
    );
  }
}
