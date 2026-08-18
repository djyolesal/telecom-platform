import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import '../../../core/bloc/list_cubit.dart';
import '../../../core/widgets/common_widgets.dart';
import '../../../core/widgets/barre_recherche.dart';
import '../../../core/widgets/filtre_statuts.dart';
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
  // Filtre LOCAL (l'API des dépotages n'a pas de paramètre de recherche) :
  // suffisant sur la page chargée - l'historique lointain se consulte au web.
  String _query = '';
  // Les dépotages n'ont pas de statut : le filtre utile est la PÉRIODE.
  String? _periode;

  static const _periodes = [
    MapEntry('JOUR', "Aujourd'hui"),
    MapEntry('SEMAINE', '7 jours'),
  ];

  void _reload(BuildContext context) {
    final repo = context.read<DepotageRepository>();
    context.read<ListCubit<Depotage>>().run(() => repo.getDepotages());
  }

  bool _dansPeriode(Depotage d, String periode) {
    final date = d.dateDepotage;
    if (date == null) return false;
    final age = DateTime.now().difference(date);
    return periode == 'JOUR' ? age.inHours < 24 : age.inDays < 7;
  }

  List<Depotage> _filtrer(List<Depotage> items) {
    final q = _query.toLowerCase();
    return items
        .where((d) =>
            (_periode == null || _dansPeriode(d, _periode!)) &&
            (q.isEmpty ||
                (d.siteNom ?? '').toLowerCase().contains(q) ||
                (d.reference ?? '').toLowerCase().contains(q) ||
                (d.fournisseur ?? '').toLowerCase().contains(q)))
        .toList();
  }

  /// Dépotage intelligent (helper partagé avec le tableau de bord).
  Future<void> _onDepoter(BuildContext context) async {
    await smartDepoter(context);
    if (context.mounted) _reload(context);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Dépotages'),
        bottom: BarreRecherche(
          hint: 'Rechercher (site, référence, fournisseur)…',
          onChanged: (q) => setState(() => _query = q),
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _onDepoter(context),
        icon: const Icon(Icons.add_location_alt),
        label: const Text('Dépotage'),
      ),
      body: BlocBuilder<ListCubit<Depotage>, ListState<Depotage>>(
        builder: (context, state) {
          if (state.status == ResourceStatus.loading) {
            return const LoadingView();
          }
          if (state.status == ResourceStatus.failure) {
            return ErrorView(
                message: state.error ?? 'Erreur',
                onRetry: () => _reload(context));
          }
          final items = _filtrer(state.items);
          final comptes = <String, int>{
            for (final p in _periodes)
              p.key: state.items.where((d) => _dansPeriode(d, p.key)).length,
          };
          return Column(children: [
            FiltreStatuts(
              options: _periodes,
              comptes: comptes,
              valeur: _periode,
              onChanged: (v) => setState(() => _periode = v),
            ),
            Expanded(
              child: items.isEmpty
                  ? (_query.isEmpty && _periode == null
                      ? const EmptyView(
                          title: 'Aucun dépotage',
                          hint:
                              'Les dépotages nécessitent une connexion pour l\'historique.')
                      : const EmptyView(
                          title: 'Aucun résultat',
                          hint:
                              'La recherche porte sur la page chargée - l\'historique complet est sur le portail web.'))
                  : RefreshIndicator(
                      onRefresh: () async => _reload(context),
                      child: ListView.separated(
                        itemCount: items.length,
                        separatorBuilder: (_, __) => const Divider(height: 1),
                        itemBuilder: (context, i) {
                          final d = items[i];
                          return ListTile(
                            leading: const CircleAvatar(
                                child: Icon(Icons.local_gas_station, size: 20)),
                            title: Text(
                                '${d.siteNom ?? '—'} · ${fmtLitres(d.volumeLitres)}',
                                style: const TextStyle(
                                    fontWeight: FontWeight.w600)),
                            subtitle: Text(
                                '${fmtDate(d.dateDepotage)}${d.fournisseur != null ? ' · ${d.fournisseur}' : ''}'),
                            trailing: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                if (d.photoCount > 0) ...[
                                  const Icon(Icons.photo_camera_outlined,
                                      size: 15, color: Colors.grey),
                                  const SizedBox(width: 2),
                                  Text('${d.photoCount}',
                                      style: const TextStyle(
                                          fontSize: 12, color: Colors.grey)),
                                  const SizedBox(width: 6),
                                ],
                                const Icon(Icons.chevron_right),
                              ],
                            ),
                            onTap: () =>
                                context.push('/carburant/detail/${d.id}'),
                          );
                        },
                      ),
                    ),
            ),
          ]);
        },
      ),
    );
  }
}
