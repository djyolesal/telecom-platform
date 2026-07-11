import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../core/widgets/common_widgets.dart';
import '../../../core/services/maps_launcher.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/constants/enums.dart';
import '../../../core/utils/formatters.dart';
import '../data/site_model.dart';
import '../data/site_repository.dart';

class SiteDetailScreen extends StatefulWidget {
  final String siteId;
  const SiteDetailScreen({super.key, required this.siteId});

  @override
  State<SiteDetailScreen> createState() => _SiteDetailScreenState();
}

class _SiteDetailScreenState extends State<SiteDetailScreen> {
  late Future<Site> _siteFuture;
  late Future<SiteStock?> _stockFuture;
  late Future<List<TacheSite>> _tachesFuture;

  @override
  void initState() {
    super.initState();
    final repo = context.read<SiteRepository>();
    _siteFuture = repo.getSite(widget.siteId);
    _stockFuture = repo.getStock(widget.siteId);
    _tachesFuture = repo.getTachesPreventives(widget.siteId);
  }

  Color _tacheColor(String s) {
    switch (s) {
      case 'EN_RETARD':
        return AppColors.critique;
      case 'JAMAIS':
        return AppColors.majeur;
      case 'A_JOUR':
        return AppColors.accent;
      default:
        return Colors.grey;
    }
  }

  String _tacheStatut(String s) => s == 'EN_RETARD' ? 'En retard' : s == 'JAMAIS' ? 'Jamais' : s == 'A_JOUR' ? 'À jour' : '—';

  Color _stockColor(String niveau) {
    switch (niveau) {
      case 'VIDE':
      case 'CRITIQUE':
        return AppColors.critique;
      case 'FAIBLE':
        return AppColors.majeur;
      case 'OK':
        return AppColors.accent;
      default:
        return Colors.grey;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Fiche site')),
      body: FutureBuilder<Site>(
        future: _siteFuture,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) return const LoadingView();
          if (snap.hasError || !snap.hasData) {
            return ErrorView(message: 'Site indisponible', onRetry: () {});
          }
          final s = snap.data!;
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text(s.nom, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: AppColors.brand)),
              Text(s.code, style: const TextStyle(fontSize: 15, color: Colors.black87)),
              Text('${s.region}${s.ville != null ? ' · ${s.ville}' : ''}', style: TextStyle(color: Colors.grey.shade600)),
              const SizedBox(height: 16),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    children: [
                      _row('Configuration', s.powerConfig),
                      _row('Statut GE', s.statutGe),
                      _row('Puissance GE', '${s.puissanceGeKva.toStringAsFixed(0)} kVA'),
                      if (s.latitude != null) _row('Coordonnées', '${s.latitude!.toStringAsFixed(4)}, ${s.longitude!.toStringAsFixed(4)}'),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 8),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Infrastructure', style: TextStyle(fontWeight: FontWeight.w600)),
                      const SizedBox(height: 8),
                      if (s.typePylone != null) _row('Type de pylône', _pyloneLabel(s.typePylone!)),
                      _row('Climatiseur', s.hasClimatiseur ? 'Oui' : 'Non'),
                      _row('Extincteurs', s.hasExtincteurs ? 'Oui' : 'Non'),
                      if (s.cuveVolumeLitres != null) _row('Volume cuve', '${s.cuveVolumeLitres!.toStringAsFixed(0)} L'),
                      if (s.formeCuve != null) _row('Forme cuve', _formeLabel(s.formeCuve!)),
                      if (s.cuveDimensions != null && s.cuveDimensions!.isNotEmpty) _row('Dimensions cuve', s.cuveDimensions!),
                      _row('Agent de sécurité', s.hasGardien ? 'Oui' : 'Non'),
                      if (s.societeGardiennage != null && s.societeGardiennage!.isNotEmpty)
                        _row('Sté gardiennage', s.societeGardiennage!),
                      if (s.telephoneSite != null && s.telephoneSite!.isNotEmpty) _phoneRow(s.telephoneSite!),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 8),
              FutureBuilder<SiteStock?>(
                future: _stockFuture,
                builder: (context, stockSnap) {
                  final stock = stockSnap.data;
                  if (stock == null) return const SizedBox.shrink();
                  return Card(
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              const Text('Stock carburant', style: TextStyle(fontWeight: FontWeight.w600)),
                              const Spacer(),
                              StatusChip(label: stock.niveauAlerte, color: _stockColor(stock.niveauAlerte)),
                            ],
                          ),
                          const SizedBox(height: 8),
                          _row('Stock actuel', fmtLitres(stock.stockLitres)),
                          if (stock.autonomieJours != null) _row('Autonomie', '${stock.autonomieJours} jours'),
                          _row('Conso estimée', '${fmtLitres(stock.litresMois)} / mois'),
                          _row('Coût estimé', fmtFcfa(stock.coutMoisFCFA)),
                        ],
                      ),
                    ),
                  );
                },
              ),
              const SizedBox(height: 8),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Maintenance', style: TextStyle(fontWeight: FontWeight.w600)),
                      const SizedBox(height: 8),
                      if (s.lotCode == null)
                        Text('Aucun lot attribué', style: TextStyle(color: Colors.grey.shade500, fontSize: 13))
                      else ...[
                        _row('Lot', '${s.lotCode}${s.lotNom != null ? ' — ${s.lotNom}' : ''}'),
                        const SizedBox(height: 4),
                        if (s.attributions.isEmpty)
                          Text('Aucun prestataire attribué', style: TextStyle(color: Colors.grey.shade500, fontSize: 13)),
                        ...s.attributions.map((a) => Padding(
                              padding: const EdgeInsets.symmetric(vertical: 3),
                              child: Row(
                                children: [
                                  StatusChip(label: _scopeLabel(a.scope), color: AppColors.brandLight),
                                  const SizedBox(width: 8),
                                  Expanded(child: Text(a.prestataireNom, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500))),
                                  if (a.prestataireTel != null)
                                    Text(a.prestataireTel!, style: TextStyle(color: Colors.grey.shade500, fontSize: 12)),
                                ],
                              ),
                            )),
                      ],
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 8),
              FutureBuilder<List<TacheSite>>(
                future: _tachesFuture,
                builder: (context, tSnap) {
                  final taches = tSnap.data ?? [];
                  if (taches.isEmpty) return const SizedBox.shrink();
                  return Card(
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Tâches préventives contractuelles (${taches.length})', style: const TextStyle(fontWeight: FontWeight.w600)),
                          const SizedBox(height: 8),
                          ...taches.map((t) => Padding(
                                padding: const EdgeInsets.symmetric(vertical: 3),
                                child: Row(
                                  children: [
                                    StatusChip(label: _tacheStatut(t.statut), color: _tacheColor(t.statut)),
                                    const SizedBox(width: 8),
                                    Expanded(child: Text(t.libelle, style: const TextStyle(fontSize: 13))),
                                    Text(t.frequenceLabel, style: TextStyle(color: Colors.grey.shade500, fontSize: 11)),
                                  ],
                                ),
                              )),
                        ],
                      ),
                    ),
                  );
                },
              ),
              const SizedBox(height: 16),
              Wrap(
                spacing: 10,
                runSpacing: 10,
                children: [
                  if (s.latitude != null && s.longitude != null)
                    _action(context, Icons.navigation, 'Itinéraire', () => _navigateTo(s)),
                  _action(context, Icons.build, 'Maintenance', () => context.push('/maintenance/nouveau?siteId=${s.id}')),
                  _action(context, Icons.local_gas_station, 'Dépotage', () => context.push('/carburant/nouveau?siteId=${s.id}')),
                  // Consultation seule : les relevés naissent des maintenances/dépotages.
                  _action(context, Icons.bolt, 'Relevés', () => context.push('/energie?siteId=${s.id}')),
                  _action(context, Icons.warning_amber, 'Incident', () => context.push('/incidents/nouveau?siteId=${s.id}')),
                ],
              ),
            ],
          );
        },
      ),
    );
  }

  /// Ouvre la navigation GPS native vers le site (Google/Apple Maps).
  Future<void> _navigateTo(Site s) async {
    final ok = await MapsLauncher.directionsTo(s.latitude!, s.longitude!);
    if (!ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Impossible d\'ouvrir la navigation')),
      );
    }
  }

  /// Téléphone du gardien/contact local : appel direct depuis le terrain.
  Widget _phoneRow(String tel) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 5),
        child: InkWell(
          onTap: () => launchUrl(Uri(scheme: 'tel', path: tel.replaceAll(' ', ''))),
          child: Row(
            children: [
              Expanded(child: Text('Téléphone site', style: TextStyle(color: Colors.grey.shade600, fontSize: 13))),
              Icon(Icons.phone, size: 15, color: Colors.teal.shade700),
              const SizedBox(width: 4),
              Text(tel, style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13, color: Colors.teal.shade700)),
            ],
          ),
        ),
      );

  Widget _row(String label, String value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 5),
        child: Row(
          children: [
            Expanded(child: Text(label, style: TextStyle(color: Colors.grey.shade600, fontSize: 13))),
            Text(_label(value), style: const TextStyle(fontWeight: FontWeight.w500, fontSize: 13)),
          ],
        ),
      );

  // Traduit certains codes enum en libellés lisibles si connus.
  String _label(String v) =>
      kStatutMaintenance[v] ?? kSourceEnergie[v] ?? v;

  String _pyloneLabel(String v) {
    const m = {
      'GREENFIELD': 'Greenfield', 'ROOFTOP': 'Rooftop', 'TGC_GREENFIELD': 'TGC-Greenfield',
      'TROTTOIR': 'Trottoir', 'RURAL': 'Rural', 'LP_GREENFIELD': 'LP-Greenfield',
    };
    return m[v] ?? v;
  }

  String _formeLabel(String v) => v == 'CYLINDRE_COUCHE' ? 'Cylindre couché' : (v == 'RECTANGULAIRE' ? 'Rectangulaire' : v);

  String _scopeLabel(String s) {
    switch (s) {
      case 'PASSIVE':
        return 'Passive';
      case 'ACTIVE':
        return 'Active';
      case 'LES_DEUX':
        return 'Passive + Active';
      default:
        return s;
    }
  }

  Widget _action(BuildContext context, IconData icon, String label, VoidCallback onTap) => SizedBox(
        width: (MediaQuery.of(context).size.width - 42) / 2,
        child: OutlinedButton.icon(
          onPressed: onTap,
          icon: Icon(icon, size: 18),
          label: Text(label),
          style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 14)),
        ),
      );
}
