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
    // Ré-évalue la disponibilité du verrou APRÈS l'attachement de l'activité
    // (au boot release, la première interrogation peut échouer — cf. AuthCubit).
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) context.read<AuthCubit>().rafraichirVerrou();
    });
  }

  void _load() {
    // Transporteur : l'API lui refuse (403) tout ce qui n'est pas appro
    // carburant — on ne charge ni le pouls du parc ni les maintenances.
    if (context.read<AuthCubit>().state.user?.role == 'TRANSPORTEUR') {
      _future = Future.value(null);
      _nbPlanifiees = Future.value(null);
      return;
    }
    _future = context.read<DashboardRepository>().getDashboard();
    _nbPlanifiees = context
        .read<MaintenanceRepository>()
        .getMaintenances(statut: 'PLANIFIEE')
        .then<int?>((l) => l.length)
        .catchError((_) => null);
  }

  void _reload() => setState(_load);

  int _n(dynamic v) => v is num ? v.toInt() : 0;

  /// Feuille listant les saisies en attente de confirmation : pour chacune, les
  /// avertissements de vraisemblance, puis « Confirmer » (rejoue avec accord) ou
  /// « Abandonner » (retire la saisie et révoque l'état optimiste).
  Future<void> _ouvrirConfirmations(
      BuildContext context, SyncService sync) async {
    final messenger = ScaffoldMessenger.of(context);
    final entries = await sync.confirmationsEnAttente();
    if (!context.mounted || entries.isEmpty) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.6,
        maxChildSize: 0.9,
        builder: (ctx, scroll) => ListView(
          controller: scroll,
          padding: const EdgeInsets.all(16),
          children: [
            Text('Saisies à confirmer',
                style: Theme.of(ctx).textTheme.titleMedium),
            const SizedBox(height: 4),
            Text(
                'Le serveur a signalé des valeurs inhabituelles. Vérifiez : confirmez si elles sont exactes, sinon abandonnez la saisie.',
                style: TextStyle(fontSize: 12.5, color: Colors.grey.shade600)),
            const SizedBox(height: 12),
            for (final e in entries)
              Card(
                margin: const EdgeInsets.only(bottom: 10),
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(_libelleEntite(e.entityType),
                          style: const TextStyle(fontWeight: FontWeight.w600)),
                      const SizedBox(height: 6),
                      for (final a in (e.avertissements ?? '')
                          .split('\n')
                          .where((s) => s.trim().isNotEmpty))
                        Padding(
                          padding: const EdgeInsets.only(bottom: 4),
                          child: Text('⚠ $a',
                              style: TextStyle(
                                  fontSize: 12.5,
                                  color: Colors.orange.shade900)),
                        ),
                      const SizedBox(height: 8),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.end,
                        children: [
                          TextButton(
                            onPressed: () async {
                              Navigator.of(ctx).pop();
                              await sync.annulerConfirmation(e);
                              messenger.showSnackBar(const SnackBar(
                                  content: Text('Saisie abandonnée.')));
                            },
                            child: const Text('Abandonner'),
                          ),
                          const SizedBox(width: 8),
                          FilledButton(
                            onPressed: () async {
                              Navigator.of(ctx).pop();
                              await sync.confirmer(e);
                              messenger.showSnackBar(const SnackBar(
                                  content: Text(
                                      'Saisie confirmée — envoi en cours.')));
                            },
                            child: const Text('Confirmer'),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  String _libelleEntite(String type) {
    switch (type) {
      case 'depotage':
        return 'Dépotage carburant';
      case 'maintenance':
        return 'Clôture de maintenance';
      case 'releve':
        return 'Relevé énergie';
      default:
        return type;
    }
  }

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
                            icon: _syncEnCours
                                ? const SizedBox(
                                    width: 20,
                                    height: 20,
                                    child: CircularProgressIndicator(
                                        strokeWidth: 2, color: Colors.white))
                                : const Icon(Icons.sync, color: Colors.white),
                            onPressed: _syncEnCours ? null : _syncManuel,
                          ),
                          PopupMenuButton<String>(
                            iconColor: Colors.white,
                            onSelected: (v) {
                              if (v == 'logout') {
                                context.read<AuthCubit>().logout();
                              }
                              if (v == 'biometric') _toggleBiometric();
                            },
                            // Construit à l'OUVERTURE du menu : la coche reflète
                            // l'état réel (« activer/désactiver » ne disait pas
                            // où on en était). Masquée si l'appareil n'a pas de
                            // biométrie — le geste n'aurait aucun effet.
                            itemBuilder: (_) {
                              final auth = context.read<AuthCubit>().state;
                              return [
                                if (auth.biometricAvailable)
                                  CheckedPopupMenuItem(
                                    value: 'biometric',
                                    checked: auth.biometricEnabled,
                                    child: const Text(
                                        'Verrou à l\'ouverture (biométrie ou code)'),
                                  ),
                                const PopupMenuItem(
                                    value: 'logout',
                                    child: Text('Déconnexion')),
                              ];
                            },
                          ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Text('Bonjour ${user?.prenom ?? ''} 👋',
                          style: const TextStyle(
                              color: Colors.white,
                              fontSize: 19,
                              fontWeight: FontWeight.w800)),
                      Text(user?.role ?? '',
                          style: const TextStyle(
                              color: Color(0xFF9FB3C8), fontSize: 12)),
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
              builder: (context, snap) =>
                  OfflineBanner(pendingCount: snap.data ?? 0),
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
                          const SnackBar(
                              content: Text(
                                  'Nouvel essai des opérations en échec…')),
                        );
                      }
                    },
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 16, vertical: 10),
                      child: Row(children: [
                        Icon(Icons.error_outline,
                            color: Colors.red.shade700, size: 18),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                              '$n opération(s) non envoyée(s) — vos saisies sont conservées. Touchez pour réessayer.',
                              style: TextStyle(
                                  color: Colors.red.shade800,
                                  fontSize: 13,
                                  fontWeight: FontWeight.w500)),
                        ),
                        Icon(Icons.refresh,
                            color: Colors.red.shade700, size: 18),
                      ]),
                    ),
                  ),
                );
              },
            ),
            // Bandeau : opérations mises en attente d'une confirmation (« valeurs
            // inhabituelles » détectées au rejeu hors-ligne). Sans ce canal, la
            // saisie restait bloquée sans recours. Touchez pour confirmer/abandonner.
            StreamBuilder<int>(
              stream: sync.confirmationCount,
              builder: (context, snap) {
                final n = snap.data ?? 0;
                if (n == 0) return const SizedBox.shrink();
                return Material(
                  color: Colors.orange.shade50,
                  child: InkWell(
                    onTap: () => _ouvrirConfirmations(context, sync),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 16, vertical: 10),
                      child: Row(children: [
                        Icon(Icons.help_outline,
                            color: Colors.orange.shade800, size: 18),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                              '$n saisie(s) à confirmer — valeurs inhabituelles signalées. Touchez pour vérifier.',
                              style: TextStyle(
                                  color: Colors.orange.shade900,
                                  fontSize: 13,
                                  fontWeight: FontWeight.w500)),
                        ),
                        Icon(Icons.chevron_right,
                            color: Colors.orange.shade800, size: 18),
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
                    // Transporteur : périmètre limité à l'appro carburant — pas de
                    // pouls du parc ni d'actions terrain, uniquement ses bons.
                    if ((user?.role ?? '') == 'TRANSPORTEUR') ...[
                      const Text('APPRO CARBURANT',
                          style: TextStyle(
                              fontSize: 10.5,
                              fontWeight: FontWeight.w700,
                              letterSpacing: 1.2,
                              color: Colors.grey)),
                      const SizedBox(height: 8),
                      _ActionCard(
                        color: AppColors.brand,
                        foreground: Colors.white,
                        icon: Icons.local_shipping,
                        title: 'Nouveau bon de livraison',
                        subtitle: 'déclarer un chargement',
                        onTap: () =>
                            context.push('/carburant/bon-livraison/nouveau'),
                      ),
                      const SizedBox(height: 10),
                      // Ses chargements et, pour chacun, le plan de livraison
                      // (sites + volumes) exportable en PDF.
                      _ActionCard(
                        color: Colors.white,
                        foreground: AppColors.brand,
                        icon: Icons.checklist_rtl,
                        title: 'Mes livraisons planifiées',
                        subtitle: 'plan par site · export PDF',
                        onTap: () => context.push('/carburant/bons-livraison'),
                      ),
                    ] else ...[
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
                                  Icon(Icons.cloud_off,
                                      color: Colors.grey.shade400),
                                  const SizedBox(width: 10),
                                  const Expanded(
                                      child: Text(
                                          'Pouls du parc indisponible hors-ligne')),
                                ]),
                              ),
                            );
                          }
                          final critiques = _n(d['sitesCritiques']);
                          final faibles = _n(d['sitesFaibles']);
                          final ok = d['sitesOk'] != null
                              ? _n(d['sitesOk'])
                              : (_n(d['sitesActifs']) - critiques - faibles)
                                  .clamp(0, 1 << 31);
                          final incidents = _n(d['incidentsOuverts']);
                          final incidentsCrit = _n(d['incidentsCritiques']);
                          return Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              PoulsParc(
                                ok: ok,
                                faible: faibles,
                                critique: critiques,
                                stockTotalLitres:
                                    (d['stockTotalLitres'] ?? 0) as num,
                                onTap: () => context.push('/sites'),
                              ),
                              if (incidents > 0) ...[
                                const SizedBox(height: 10),
                                InkWell(
                                  onTap: () => context.push('/incidents'),
                                  borderRadius: BorderRadius.circular(12),
                                  child: Container(
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 12, vertical: 10),
                                    decoration: BoxDecoration(
                                      color: incidentsCrit > 0
                                          ? const Color(0xFFFDE8E8)
                                          : const Color(0xFFFEF3DF),
                                      borderRadius: BorderRadius.circular(12),
                                    ),
                                    child: Row(children: [
                                      Icon(Icons.warning_amber,
                                          size: 18,
                                          color: incidentsCrit > 0
                                              ? AppColors.critique
                                              : AppColors.majeur),
                                      const SizedBox(width: 8),
                                      Expanded(
                                        child: Text(
                                          '$incidents incident${incidents > 1 ? 's' : ''} ouvert${incidents > 1 ? 's' : ''}'
                                          '${incidentsCrit > 0 ? ' · dont $incidentsCrit critique${incidentsCrit > 1 ? 's' : ''}' : ''}',
                                          style: const TextStyle(
                                              fontSize: 12.5,
                                              fontWeight: FontWeight.w600),
                                        ),
                                      ),
                                      const Icon(Icons.chevron_right,
                                          size: 18, color: Colors.grey),
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
                          style: TextStyle(
                              fontSize: 10.5,
                              fontWeight: FontWeight.w700,
                              letterSpacing: 1.2,
                              color: Colors.grey)),
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
                                subtitle: snap.data != null
                                    ? '${snap.data} planifiée${(snap.data ?? 0) > 1 ? 's' : ''}'
                                    : 'voir le planning',
                                onTap: () => context.push('/maintenance'),
                              ),
                            ),
                          ),
                        ],
                      ),
                      // ── Modules ──
                      const SizedBox(height: 18),
                      const Text('MODULES',
                          style: TextStyle(
                              fontSize: 10.5,
                              fontWeight: FontWeight.w700,
                              letterSpacing: 1.2,
                              color: Colors.grey)),
                      const SizedBox(height: 8),
                      _moduleGrid(context),
                    ],
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
      (_M('Carburant', Icons.local_gas_station, '/carburant',
          AppColors.accent)),
      (_M('Énergie', Icons.bolt, '/energie', AppColors.brandLight)),
      (_M('Incidents', Icons.warning_amber, '/incidents', AppColors.critique)),
      // Saisie d'un bon de livraison (transporteur / manager / admin).
      if (role == 'TRANSPORTEUR' || role == 'MANAGER' || role == 'ADMIN')
        (_M('Bon livraison', Icons.local_shipping,
            '/carburant/bon-livraison/nouveau', AppColors.brand)),
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
                        decoration: BoxDecoration(
                            color: m.color,
                            borderRadius: BorderRadius.circular(12)),
                        child: Icon(m.icon, color: Colors.white),
                      ),
                      const SizedBox(height: 8),
                      Text(m.label,
                          style: const TextStyle(
                              fontSize: 12, fontWeight: FontWeight.w500)),
                    ],
                  ),
                ),
              ))
          .toList(),
    );
  }

  bool _syncEnCours = false;

  /// Synchronisation MANUELLE : le geste doit répondre quelque chose — un
  /// bouton muet laissait croire qu'il ne faisait rien (ou que tout avait
  /// échoué). Bilan chiffré : envoyées / restantes / rien à faire.
  Future<void> _syncManuel() async {
    final sync = context.read<SyncService>();
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _syncEnCours = true);
    final avant = await sync.enAttente();
    await sync.sync();
    final apres = await sync.enAttente();
    if (!mounted) return;
    setState(() => _syncEnCours = false);
    final envoyees = avant - apres;
    final s = envoyees > 1 ? 's' : '';
    final texte = avant == 0
        ? 'Rien à synchroniser — tout est à jour'
        : apres == 0
            ? '$envoyees opération$s synchronisée$s'
            : envoyees > 0
                ? '$envoyees opération$s envoyée$s · $apres toujours en attente'
                : '$apres opération${apres > 1 ? 's' : ''} en attente — envoi impossible (hors-ligne ou erreur, voir le bandeau)';
    messenger.showSnackBar(SnackBar(content: Text(texte)));
  }

  Future<void> _toggleBiometric() async {
    final cubit = context.read<AuthCubit>();
    final enabled = cubit.state.biometricEnabled;
    await cubit.toggleBiometric(!enabled);
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
            content: Text('Biométrie ${!enabled ? 'activée' : 'désactivée'}')),
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
            border:
                outlined ? Border.all(color: const Color(0xFFE4EAF0)) : null,
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
                        style: TextStyle(
                            color: foreground,
                            fontWeight: FontWeight.w800,
                            fontSize: 13.5),
                        overflow: TextOverflow.ellipsis),
                  ),
                ]),
                const SizedBox(height: 3),
                Text(subtitle,
                    style: TextStyle(
                        color: foreground.withValues(alpha: 0.75),
                        fontSize: 10.5),
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
