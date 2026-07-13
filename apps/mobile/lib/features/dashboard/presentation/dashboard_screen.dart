import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import '../../../core/sync/sync_service.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/app_logo.dart';
import '../../../core/widgets/common_widgets.dart';
import '../../auth/presentation/auth_cubit.dart';
import '../../carburant/presentation/smart_depotage.dart';
import '../../maintenance/data/maintenance_repository.dart';
import '../data/dashboard_repository.dart';
import 'pouls_parc.dart';

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  late Future<Map<String, dynamic>?> _future;
  late Future<int?> _nbPlanifiees;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    _future = context.read<DashboardRepository>().getDashboard();
    _nbPlanifiees = context
        .read<MaintenanceRepository>()
        .getMaintenances(statut: 'PLANIFIEE')
        .then<int?>((l) => l.length)
        .catchError((_) => null);
  }

  void _reload() => setState(_load);

  int _n(dynamic v) => v is num ? v.toInt() : 0;

  @override
  Widget build(BuildContext context) {
    final user = context.select((AuthCubit c) => c.state.user);
    final sync = context.read<SyncService>();

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Scaffold(
        body: Column(
          children: [
            // ── En-tête vivant : logo + salutation + synchro, fermé par la Ligne de vie ──
            Container(
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [Color(0xFF1B3F6B), Color(0xFF16345A)],
                ),
              ),
              child: SafeArea(
                bottom: false,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 6, 8, 0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          const AppLogo(size: 24, dark: true),
                          const SizedBox(width: 8),
                          const AppWordmark(fontSize: 17, dark: true),
                          const Spacer(),
                          IconButton(
                            icon: const Icon(Icons.sync, color: Colors.white),
                            onPressed: () => sync.sync(),
                          ),
                          PopupMenuButton<String>(
                            iconColor: Colors.white,
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
                      const SizedBox(height: 6),
                      Text('Bonjour ${user?.prenom ?? ''} 👋',
                          style: const TextStyle(color: Colors.white, fontSize: 19, fontWeight: FontWeight.w800)),
                      Text(user?.role ?? '', style: const TextStyle(color: Color(0xFF9FB3C8), fontSize: 12)),
                      const Padding(
                        padding: EdgeInsets.only(top: 8, right: 8),
                        child: LigneDeVie(),
                      ),
                      const SizedBox(height: 6),
                    ],
                  ),
                ),
              ),
            ),
            StreamBuilder<int>(
              stream: sync.pendingCount,
              builder: (context, snap) => OfflineBanner(pendingCount: snap.data ?? 0),
            ),
            // Bandeau d'alerte : opérations qui n'ont pas pu partir (échec serveur
            // répété). Elles ne sont JAMAIS supprimées ; un appui relance l'envoi.
            StreamBuilder<int>(
              stream: sync.failedCount,
              builder: (context, snap) {
                final n = snap.data ?? 0;
                if (n == 0) return const SizedBox.shrink();
                return Material(
                  color: Colors.red.shade50,
                  child: InkWell(
                    onTap: () async {
                      final entries = await sync.failedEntries();
                      if (!context.mounted) return;
                      for (final e in entries) {
                        sync.retryFailed(e.localId);
                      }
                      if (context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Nouvel essai des opérations en échec…')),
                        );
                      }
                    },
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                      child: Row(children: [
                        Icon(Icons.error_outline, color: Colors.red.shade700, size: 18),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text('$n opération(s) non envoyée(s) — vos saisies sont conservées. Touchez pour réessayer.',
                              style: TextStyle(color: Colors.red.shade800, fontSize: 13, fontWeight: FontWeight.w500)),
                        ),
                        Icon(Icons.refresh, color: Colors.red.shade700, size: 18),
                      ]),
                    ),
                  ),
                );
              },
            ),
            Expanded(
              child: RefreshIndicator(
                onRefresh: () async => _reload(),
                child: ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    // ── Pouls du parc ──
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
                                const Expanded(child: Text('Pouls du parc indisponible hors-ligne')),
                              ]),
                            ),
                          );
                        }
                        final critiques = _n(d['sitesCritiques']);
                        final faibles = _n(d['sitesFaibles']);
                        final ok = d['sitesOk'] != null
                            ? _n(d['sitesOk'])
                            : (_n(d['sitesActifs']) - critiques - faibles).clamp(0, 1 << 31);
                        final incidents = _n(d['incidentsOuverts']);
                        final incidentsCrit = _n(d['incidentsCritiques']);
                        return Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            PoulsParc(
                              ok: ok,
                              faible: faibles,
                              critique: critiques,
                              stockTotalLitres: (d['stockTotalLitres'] ?? 0) as num,
                              onTap: () => context.push('/sites'),
                            ),
                            if (incidents > 0) ...[
                              const SizedBox(height: 10),
                              InkWell(
                                onTap: () => context.push('/incidents'),
                                borderRadius: BorderRadius.circular(12),
                                child: Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                                  decoration: BoxDecoration(
                                    color: incidentsCrit > 0 ? const Color(0xFFFDE8E8) : const Color(0xFFFEF3DF),
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: Row(children: [
                                    Icon(Icons.warning_amber,
                                        size: 18, color: incidentsCrit > 0 ? AppColors.critique : AppColors.majeur),
                                    const SizedBox(width: 8),
                                    Expanded(
                                      child: Text(
                                        '$incidents incident${incidents > 1 ? 's' : ''} ouvert${incidents > 1 ? 's' : ''}'
                                        '${incidentsCrit > 0 ? ' · dont $incidentsCrit critique${incidentsCrit > 1 ? 's' : ''}' : ''}',
                                        style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600),
                                      ),
                                    ),
                                    const Icon(Icons.chevron_right, size: 18, color: Colors.grey),
                                  ]),
                                ),
                              ),
                            ],
                          ],
                        );
                      },
                    ),
                    // ── Actions rapides ──
                    const SizedBox(height: 18),
                    const Text('ACTIONS RAPIDES',
                        style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, letterSpacing: 1.2, color: Colors.grey)),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Expanded(
                          child: _ActionCard(
                            color: AppColors.accent,
                            foreground: Colors.white,
                            icon: Icons.local_gas_station,
                            title: 'Dépoter',
                            subtitle: 'détection GPS du site',
                            onTap: () => smartDepoter(context),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: FutureBuilder<int?>(
                            future: _nbPlanifiees,
                            builder: (context, snap) => _ActionCard(
                              color: Colors.white,
                              foreground: AppColors.brand,
                              outlined: true,
                              icon: Icons.build,
                              title: 'Mes maintenances',
                              subtitle: snap.data != null ? '${snap.data} planifiée${(snap.data ?? 0) > 1 ? 's' : ''}' : 'voir le planning',
                              onTap: () => context.push('/maintenance'),
                            ),
                          ),
                        ),
                      ],
                    ),
                    // ── Modules ──
                    const SizedBox(height: 18),
                    const Text('MODULES',
                        style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, letterSpacing: 1.2, color: Colors.grey)),
                    const SizedBox(height: 8),
                    _moduleGrid(context),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _moduleGrid(BuildContext context) {
    final role = context.select((AuthCubit c) => c.state.user?.role) ?? '';
    final modules = [
      (_M('Scanner', Icons.qr_code_scanner, '/scan', AppColors.accent)),
      (_M('Sites', Icons.cell_tower, '/sites', AppColors.brand)),
      (_M('Maintenance', Icons.build, '/maintenance', AppColors.brandLight)),
      (_M('Carburant', Icons.local_gas_station, '/carburant', AppColors.accent)),
      (_M('Énergie', Icons.bolt, '/energie', AppColors.brandLight)),
      (_M('Incidents', Icons.warning_amber, '/incidents', AppColors.critique)),
      // Saisie d'un bon de livraison (transporteur / manager / admin).
      if (role == 'TRANSPORTEUR' || role == 'MANAGER' || role == 'ADMIN')
        (_M('Bon livraison', Icons.local_shipping, '/carburant/bon-livraison/nouveau', AppColors.brand)),
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

/// Carte d'action rapide (Dépoter GPS / Mes maintenances).
class _ActionCard extends StatelessWidget {
  final Color color;
  final Color foreground;
  final bool outlined;
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  const _ActionCard({
    required this.color,
    required this.foreground,
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.outlined = false,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(13),
        child: Ink(
          decoration: BoxDecoration(
            color: color,
            borderRadius: BorderRadius.circular(13),
            border: outlined ? Border.all(color: const Color(0xFFE4EAF0)) : null,
          ),
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(children: [
                  Icon(icon, size: 18, color: foreground),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(title,
                        style: TextStyle(color: foreground, fontWeight: FontWeight.w800, fontSize: 13.5),
                        overflow: TextOverflow.ellipsis),
                  ),
                ]),
                const SizedBox(height: 3),
                Text(subtitle,
                    style: TextStyle(color: foreground.withValues(alpha: 0.75), fontSize: 10.5),
                    overflow: TextOverflow.ellipsis),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _M {
  final String label;
  final IconData icon;
  final String route;
  final Color color;
  _M(this.label, this.icon, this.route, this.color);
}
