import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import '../../../core/sync/sync_service.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/formatters.dart';
import '../../../core/widgets/common_widgets.dart';
import '../../auth/presentation/auth_cubit.dart';
import '../data/dashboard_repository.dart';

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  late Future<Map<String, dynamic>?> _future;

  @override
  void initState() {
    super.initState();
    _future = context.read<DashboardRepository>().getDashboard();
  }

  void _reload() => setState(() => _future = context.read<DashboardRepository>().getDashboard());

  @override
  Widget build(BuildContext context) {
    final user = context.select((AuthCubit c) => c.state.user);
    final sync = context.read<SyncService>();

    return Scaffold(
      appBar: AppBar(
        title: const Text('TélécomOps'),
        actions: [
          IconButton(icon: const Icon(Icons.sync), onPressed: () => sync.sync()),
          PopupMenuButton<String>(
            onSelected: (v) {
              if (v == 'logout') context.read<AuthCubit>().logout();
              if (v == 'biometric') _toggleBiometric();
            },
            itemBuilder: (_) => [
              const PopupMenuItem(value: 'biometric', child: Text('Activer/désactiver biométrie')),
              const PopupMenuItem(value: 'logout', child: Text('Déconnexion')),
            ],
          ),
        ],
      ),
      body: Column(
        children: [
          StreamBuilder<int>(
            stream: sync.pendingCount,
            builder: (context, snap) => OfflineBanner(pendingCount: snap.data ?? 0),
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: () async => _reload(),
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Text('Bonjour ${user?.prenom ?? ''} 👋', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                  Text(user?.role ?? '', style: TextStyle(color: Colors.grey.shade500, fontSize: 13)),
                  const SizedBox(height: 16),
                  FutureBuilder<Map<String, dynamic>?>(
                    future: _future,
                    builder: (context, snap) {
                      final d = snap.data;
                      if (d == null) {
                        return Card(
                          child: Padding(
                            padding: const EdgeInsets.all(16),
                            child: Row(children: [
                              Icon(Icons.cloud_off, color: Colors.grey.shade400),
                              const SizedBox(width: 10),
                              const Expanded(child: Text('Indicateurs indisponibles hors-ligne')),
                            ]),
                          ),
                        );
                      }
                      return GridView.count(
                        crossAxisCount: 2,
                        shrinkWrap: true,
                        physics: const NeverScrollableScrollPhysics(),
                        mainAxisSpacing: 10,
                        crossAxisSpacing: 10,
                        childAspectRatio: 1.5,
                        children: [
                          StatTile(title: 'Sites actifs', value: fmtNum(d['sitesActifs']), icon: Icons.cell_tower, color: AppColors.brand),
                          StatTile(title: 'Incidents ouverts', value: fmtNum(d['incidentsOuverts']), icon: Icons.warning_amber, color: AppColors.critique),
                          StatTile(title: 'Sites stock critique', value: fmtNum(d['sitesCritiques']), icon: Icons.local_gas_station, color: AppColors.majeur),
                          StatTile(title: 'Stock total', value: '${fmtNum(((d['stockTotalLitres'] ?? 0) as num) ~/ 1000)}k L', icon: Icons.water_drop, color: AppColors.accent),
                        ],
                      );
                    },
                  ),
                  const SizedBox(height: 20),
                  const Text('Modules', style: TextStyle(fontWeight: FontWeight.w600)),
                  const SizedBox(height: 10),
                  _moduleGrid(context),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _moduleGrid(BuildContext context) {
    final modules = [
      (_M('Sites', Icons.cell_tower, '/sites', AppColors.brand)),
      (_M('Maintenance', Icons.build, '/maintenance', AppColors.brandLight)),
      (_M('Carburant', Icons.local_gas_station, '/carburant', AppColors.accent)),
      (_M('Énergie', Icons.bolt, '/energie', AppColors.brandLight)),
      (_M('Incidents', Icons.warning_amber, '/incidents', AppColors.critique)),
    ];
    return GridView.count(
      crossAxisCount: 3,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 10,
      crossAxisSpacing: 10,
      childAspectRatio: 0.95,
      children: modules
          .map((m) => InkWell(
                onTap: () => context.push(m.route),
                borderRadius: BorderRadius.circular(14),
                child: Card(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(color: m.color, borderRadius: BorderRadius.circular(12)),
                        child: Icon(m.icon, color: Colors.white),
                      ),
                      const SizedBox(height: 8),
                      Text(m.label, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500)),
                    ],
                  ),
                ),
              ))
          .toList(),
    );
  }

  Future<void> _toggleBiometric() async {
    final cubit = context.read<AuthCubit>();
    final enabled = cubit.state.biometricEnabled;
    await cubit.toggleBiometric(!enabled);
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Biométrie ${!enabled ? 'activée' : 'désactivée'}')),
      );
    }
  }
}

class _M {
  final String label;
  final IconData icon;
  final String route;
  final Color color;
  _M(this.label, this.icon, this.route, this.color);
}
