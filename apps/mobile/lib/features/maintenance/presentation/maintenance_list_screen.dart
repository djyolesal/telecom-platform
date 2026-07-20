import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import '../../../core/bloc/list_cubit.dart';
import '../../../core/config/app_config.dart';
import '../../../core/services/location_service.dart';
import '../../../core/widgets/common_widgets.dart';
import '../../../core/widgets/gps_refine_sheet.dart';
import '../../../core/constants/enums.dart';
import '../../../core/utils/formatters.dart';
import '../../sites/data/site_model.dart';
import '../../sites/data/site_repository.dart';
import '../data/maintenance_model.dart';
import '../data/maintenance_repository.dart';

class MaintenanceListScreen extends StatelessWidget {
  const MaintenanceListScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final repo = context.read<MaintenanceRepository>();
    return BlocProvider(
      create: (_) => ListCubit<Maintenance>()..run(() => repo.getMaintenances()),
      child: const _MaintenanceView(),
    );
  }
}

class _MaintenanceView extends StatefulWidget {
  const _MaintenanceView();

  @override
  State<_MaintenanceView> createState() => _MaintenanceViewState();
}

class _MaintenanceViewState extends State<_MaintenanceView> {
  final _searchCtrl = TextEditingController();
  Timer? _debounce;
  String _query = '';

  @override
  void dispose() {
    _debounce?.cancel();
    _searchCtrl.dispose();
    super.dispose();
  }

  void _onSearchChanged(String v) {
    setState(() {}); // rafraîchit l'icône d'effacement
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), () {
      if (!mounted) return;
      _query = v.trim();
      _reload(context);
    });
  }

  Color _statutColor(String s) {
    switch (s) {
      case 'EN_COURS':
        return Colors.orange;
      case 'TERMINEE':
        return Colors.green;
      case 'ANNULEE':
        return Colors.grey;
      default:
        return Colors.blue;
    }
  }

  void _reload(BuildContext context) {
    final repo = context.read<MaintenanceRepository>();
    context.read<ListCubit<Maintenance>>().run(() => repo.getMaintenances(search: _query));
  }

  /// Planifier intelligent : AFFINE d'abord la position (feuille avec loader
  /// et précision en direct, comme le dépotage), détecte si le technicien est
  /// SUR un site, pré-remplit ce site et propose ses maintenances planifiées ;
  /// sinon ouvre le formulaire vierge.
  Future<void> _onPlanifier(BuildContext context) async {
    final router = GoRouter.of(context);
    final siteRepo = context.read<SiteRepository>();
    final fix = await refineGpsPosition(context);
    if (!context.mounted) return;
    Site? onSite;
    double best = double.infinity;
    if (fix != null) {
      final sites = await siteRepo.getSites();
      for (final s in sites) {
        if (s.latitude == null || s.longitude == null) continue;
        final d = LocationService.distanceMeters(fix.lat, fix.lng, s.latitude!, s.longitude!);
        if (d <= AppConfig.geofenceRadiusM && d < best) {
          best = d;
          onSite = s;
        }
      }
    }
    if (!context.mounted) return;
    if (onSite != null) {
      await _showOnSiteSheet(context, onSite, fix!.accuracyM);
    } else {
      // GPS annulé/indisponible ou aucun site à proximité : formulaire vierge.
      await router.push('/maintenance/nouveau');
    }
    if (context.mounted) _reload(context);
  }

  Future<void> _showOnSiteSheet(BuildContext context, Site site, double accuracyM) async {
    final repo = context.read<MaintenanceRepository>();
    final router = GoRouter.of(context);
    final planifiees = await repo.getMaintenances(statut: 'PLANIFIEE', siteId: site.id);
    if (!context.mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (sheetCtx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(children: [
                const Icon(Icons.location_on, color: Colors.green),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                      'Vous êtes sur le site\n${site.nom}${accuracyM > 0 ? ' (± ${accuracyM.toStringAsFixed(0)} m)' : ''}',
                      style: const TextStyle(fontWeight: FontWeight.bold)),
                ),
              ]),
              const SizedBox(height: 12),
              if (planifiees.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Text('Aucune maintenance planifiée pour ce site.', style: TextStyle(color: Colors.grey.shade600)),
                )
              else ...[
                Text('Maintenances planifiées (${planifiees.length})', style: const TextStyle(fontWeight: FontWeight.w600)),
                const SizedBox(height: 4),
                Flexible(
                  child: ListView(
                    shrinkWrap: true,
                    children: planifiees
                        .map((m) => ListTile(
                              contentPadding: EdgeInsets.zero,
                              leading: const Icon(Icons.build_circle_outlined),
                              title: Text(m.equipement),
                              subtitle: Text(fmtDate(m.datePlanifiee)),
                              trailing: const Icon(Icons.chevron_right),
                              onTap: () {
                                Navigator.pop(sheetCtx);
                                router.push('/maintenance/${m.id}');
                              },
                            ))
                        .toList(),
                  ),
                ),
              ],
              const Divider(),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: () {
                    Navigator.pop(sheetCtx);
                    router.push('/maintenance/nouveau?siteId=${site.id}');
                  },
                  icon: const Icon(Icons.add),
                  label: const Text('Planifier une nouvelle tâche ici'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Maintenances'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(56),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
            child: TextField(
              controller: _searchCtrl,
              onChanged: _onSearchChanged,
              textInputAction: TextInputAction.search,
              decoration: InputDecoration(
                hintText: 'Rechercher (site, équipement)…',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: _searchCtrl.text.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.clear),
                        onPressed: () { _searchCtrl.clear(); _query = ''; _reload(context); setState(() {}); },
                      )
                    : null,
                isDense: true,
                filled: true,
                fillColor: Colors.white,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
              ),
            ),
          ),
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _onPlanifier(context),
        icon: const Icon(Icons.add_location_alt),
        label: const Text('Planifier'),
      ),
      body: BlocBuilder<ListCubit<Maintenance>, ListState<Maintenance>>(
        builder: (context, state) {
          if (state.status == ResourceStatus.loading) return const LoadingView();
          if (state.status == ResourceStatus.failure) {
            return ErrorView(message: state.error ?? 'Erreur', onRetry: () => _reload(context));
          }
          if (state.items.isEmpty) return const EmptyView(title: 'Aucune maintenance');
          return RefreshIndicator(
            onRefresh: () async => _reload(context),
            child: ListView.separated(
              itemCount: state.items.length,
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemBuilder: (context, i) {
                final m = state.items[i];
                return ListTile(
                  title: Text('${m.siteNom ?? '—'} · ${m.equipement}', style: const TextStyle(fontWeight: FontWeight.w600)),
                  subtitle: Text(
                    '${kTypeMaintenance[m.type] ?? m.type} · ${fmtDate(m.datePlanifiee)}'
                    '${m.prestataire != null ? '\n${m.prestataire}' : ''}',
                  ),
                  isThreeLine: m.prestataire != null,
                  trailing: Column(
                    mainAxisSize: MainAxisSize.min,
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      StatusChip(label: kStatutMaintenance[m.statut] ?? m.statut, color: _statutColor(m.statut)),
                      if (m.photoCount > 0) ...[
                        const SizedBox(height: 6),
                        _PhotoBadge(count: m.photoCount),
                      ],
                    ],
                  ),
                  onTap: () async {
                    await context.push('/maintenance/${m.id}');
                    if (context.mounted) _reload(context);
                  },
                );
              },
            ),
          );
        },
      ),
    );
  }
}

/// Pastille moderne indiquant le nombre de photos d'une maintenance.
class _PhotoBadge extends StatelessWidget {
  final int count;
  const _PhotoBadge({required this.count});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: const Color(0xFFEEF2FF), // indigo 50
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFC7D2FE)), // indigo 200
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.photo_camera_rounded, size: 12, color: Color(0xFF4F46E5)),
          const SizedBox(width: 3),
          Text('$count',
              style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: Color(0xFF4F46E5))),
        ],
      ),
    );
  }
}
