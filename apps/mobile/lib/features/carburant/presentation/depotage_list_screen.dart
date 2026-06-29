import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import '../../../core/bloc/list_cubit.dart';
import '../../../core/config/app_config.dart';
import '../../../core/services/location_service.dart';
import '../../../core/widgets/common_widgets.dart';
import '../../../core/utils/formatters.dart';
import '../../sites/data/site_model.dart';
import '../../sites/data/site_repository.dart';
import '../data/depotage_model.dart';
import '../data/depotage_repository.dart';

class DepotageListScreen extends StatelessWidget {
  const DepotageListScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final repo = context.read<DepotageRepository>();
    return BlocProvider(
      create: (_) => ListCubit<Depotage>()..run(() => repo.getDepotages()),
      child: const _DepotageView(),
    );
  }
}

class _DepotageView extends StatefulWidget {
  const _DepotageView();

  @override
  State<_DepotageView> createState() => _DepotageViewState();
}

class _DepotageViewState extends State<_DepotageView> {
  void _reload(BuildContext context) {
    final repo = context.read<DepotageRepository>();
    context.read<ListCubit<Depotage>>().run(() => repo.getDepotages());
  }

  /// Dépotage intelligent : détecte si le technicien est SUR un site (GPS),
  /// montre ses livraisons planifiées et pré-remplit le site ; sinon le notifie
  /// et ouvre le formulaire vierge (saisie manuelle du site).
  Future<void> _onDepoter(BuildContext context) async {
    final messenger = ScaffoldMessenger.of(context);
    final router = GoRouter.of(context);
    final siteRepo = context.read<SiteRepository>();
    // Indicateur persistant pendant le fix GPS (jusqu'à 12 s) : reste affiché
    // tant que la position n'est pas résolue, puis on le masque.
    messenger.showSnackBar(const SnackBar(
      content: Row(children: [
        SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)),
        SizedBox(width: 12),
        Text('Localisation en cours…'),
      ]),
      duration: Duration(seconds: 15),
    ));
    final pos = await LocationService().freshPosition();
    final sites = await siteRepo.getSites();
    messenger.hideCurrentSnackBar();
    Site? onSite;
    double best = double.infinity;
    if (pos != null) {
      for (final s in sites) {
        if (s.latitude == null || s.longitude == null) continue;
        final d = LocationService.distanceMeters(pos.lat, pos.lng, s.latitude!, s.longitude!);
        if (d <= AppConfig.geofenceRadiusM && d < best) {
          best = d;
          onSite = s;
        }
      }
    }
    if (!context.mounted) return;
    if (onSite != null) {
      await _showOnSiteSheet(context, onSite);
    } else {
      messenger.showSnackBar(const SnackBar(content: Text('Vous n\'êtes à proximité d\'aucun site — sélectionnez-le manuellement.')));
      await router.push('/carburant/nouveau');
    }
    if (context.mounted) _reload(context);
  }

  Future<void> _showOnSiteSheet(BuildContext context, Site site) async {
    final repo = context.read<DepotageRepository>();
    final router = GoRouter.of(context);
    final lignes = await repo.getLignesLivraison(site.id);
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
                const Icon(Icons.local_gas_station, color: Colors.green),
                const SizedBox(width: 8),
                Expanded(child: Text('Vous êtes sur le site\n${site.nom}', style: const TextStyle(fontWeight: FontWeight.bold))),
              ]),
              const SizedBox(height: 12),
              if (lignes.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Text('Aucune livraison planifiée pour ce site.', style: TextStyle(color: Colors.grey.shade600)),
                )
              else ...[
                Text('Touchez une livraison à dépoter (${lignes.length})', style: const TextStyle(fontWeight: FontWeight.w600)),
                const SizedBox(height: 4),
                Flexible(
                  child: ListView(
                    shrinkWrap: true,
                    children: lignes
                        .map((l) => ListTile(
                              contentPadding: EdgeInsets.zero,
                              leading: const Icon(Icons.local_shipping_outlined),
                              title: Text('${l.numeroBL ?? 'BL'} · ${l.volumePrevuLitres.toStringAsFixed(0)} L prévus'),
                              subtitle: l.restant > 0 ? Text('Reste à livrer : ${l.restant.toStringAsFixed(0)} L') : const Text('Soldée'),
                              trailing: const Icon(Icons.chevron_right),
                              onTap: () {
                                Navigator.pop(sheetCtx);
                                // Pré-rattache le dépotage à CETTE ligne → la livraison se solde.
                                router.push('/carburant/nouveau?siteId=${site.id}&ligneId=${l.id}');
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
                    router.push('/carburant/nouveau?siteId=${site.id}');
                  },
                  icon: const Icon(Icons.add),
                  label: const Text('Dépotage hors plan'),
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
      appBar: AppBar(title: const Text('Dépotages')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _onDepoter(context),
        icon: const Icon(Icons.add_location_alt),
        label: const Text('Dépotage'),
      ),
      body: BlocBuilder<ListCubit<Depotage>, ListState<Depotage>>(
        builder: (context, state) {
          if (state.status == ResourceStatus.loading) return const LoadingView();
          if (state.status == ResourceStatus.failure) {
            return ErrorView(message: state.error ?? 'Erreur', onRetry: () => _reload(context));
          }
          if (state.items.isEmpty) return const EmptyView(title: 'Aucun dépotage', hint: 'Les dépotages nécessitent une connexion pour l\'historique.');
          return RefreshIndicator(
            onRefresh: () async => _reload(context),
            child: ListView.separated(
              itemCount: state.items.length,
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemBuilder: (context, i) {
                final d = state.items[i];
                return ListTile(
                  leading: const CircleAvatar(child: Icon(Icons.local_gas_station, size: 20)),
                  title: Text('${d.siteNom ?? d.siteCode ?? '—'} · ${fmtLitres(d.volumeLitres)}', style: const TextStyle(fontWeight: FontWeight.w600)),
                  subtitle: Text('${fmtDate(d.dateDepotage)}${d.fournisseur != null ? ' · ${d.fournisseur}' : ''}'),
                );
              },
            ),
          );
        },
      ),
    );
  }
}
