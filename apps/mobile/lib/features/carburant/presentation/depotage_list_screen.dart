import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import '../../../core/bloc/list_cubit.dart';
import '../../../core/widgets/common_widgets.dart';
import '../../../core/utils/formatters.dart';
import '../data/depotage_model.dart';
import '../data/depotage_repository.dart';
import 'smart_depotage.dart';

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

  /// Dépotage intelligent (helper partagé avec le tableau de bord).
  Future<void> _onDepoter(BuildContext context) async {
    await smartDepoter(context);
    if (context.mounted) _reload(context);
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
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (d.photoCount > 0) ...[
                        const Icon(Icons.photo_camera_outlined, size: 15, color: Colors.grey),
                        const SizedBox(width: 2),
                        Text('${d.photoCount}', style: const TextStyle(fontSize: 12, color: Colors.grey)),
                        const SizedBox(width: 6),
                      ],
                      const Icon(Icons.chevron_right),
                    ],
                  ),
                  onTap: () => context.push('/carburant/detail/${d.id}'),
                );
              },
            ),
          );
        },
      ),
    );
  }
}
