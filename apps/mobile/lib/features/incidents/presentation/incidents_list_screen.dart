import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import '../../../core/bloc/list_cubit.dart';
import '../../../core/widgets/common_widgets.dart';
import '../../../core/widgets/barre_recherche.dart';
import '../../../core/widgets/filtre_statuts.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/constants/enums.dart';
import '../../../core/utils/formatters.dart';
import '../data/incident_model.dart';
import '../data/incident_repository.dart';

class IncidentsListScreen extends StatelessWidget {
  const IncidentsListScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final repo = context.read<IncidentRepository>();
    return BlocProvider(
      create: (_) => ListCubit<Incident>()..run(() => repo.getIncidents()),
      child: const _IncidentsView(),
    );
  }
}

class _IncidentsView extends StatefulWidget {
  const _IncidentsView();

  @override
  State<_IncidentsView> createState() => _IncidentsViewState();
}

class _IncidentsViewState extends State<_IncidentsView> {
  String _query = '';
  String? _statutFiltre;

  static const _statuts = [
    MapEntry('OUVERT', 'Ouverts'),
    MapEntry('EN_COURS', 'En cours'),
    MapEntry('RESOLU', 'Résolus'),
    MapEntry('CLOS', 'Clos'),
  ];

  void _reload(BuildContext context) {
    final repo = context.read<IncidentRepository>();
    context
        .read<ListCubit<Incident>>()
        .run(() => repo.getIncidents(search: _query));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Incidents'),
        bottom: BarreRecherche(
          hint: 'Rechercher (référence, site, description)…',
          onChanged: (q) {
            _query = q;
            _reload(context);
          },
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: AppColors.critique,
        foregroundColor:
            Colors.white, // sinon libellé marine illisible sur fond rouge
        onPressed: () async {
          await context.push('/incidents/nouveau');
          if (context.mounted) _reload(context);
        },
        icon: const Icon(Icons.add_alert),
        label: const Text('Déclarer'),
      ),
      body: BlocBuilder<ListCubit<Incident>, ListState<Incident>>(
        builder: (context, state) {
          if (state.status == ResourceStatus.loading) {
            return const LoadingView();
          }
          if (state.status == ResourceStatus.failure) {
            return ErrorView(
                message: state.error ?? 'Erreur',
                onRetry: () => _reload(context));
          }
          if (state.items.isEmpty) {
            return const EmptyView(
                title: 'Aucun incident', icon: Icons.check_circle_outline);
          }
          final comptes = <String, int>{};
          for (final inc in state.items) {
            comptes[inc.statut] = (comptes[inc.statut] ?? 0) + 1;
          }
          final visibles = _statutFiltre == null
              ? state.items
              : state.items
                  .where((inc) => inc.statut == _statutFiltre)
                  .toList();
          return Column(children: [
            FiltreStatuts(
              options: _statuts,
              comptes: comptes,
              valeur: _statutFiltre,
              onChanged: (v) => setState(() => _statutFiltre = v),
            ),
            Expanded(
              child: visibles.isEmpty
                  ? const EmptyView(title: 'Rien dans ce statut')
                  : RefreshIndicator(
                      onRefresh: () async => _reload(context),
                      child: ListView.separated(
                        itemCount: visibles.length,
                        separatorBuilder: (_, __) => const Divider(height: 1),
                        itemBuilder: (context, i) {
                          final inc = visibles[i];
                          return ListTile(
                            leading: CircleAvatar(
                              backgroundColor:
                                  AppTheme.severiteColor(inc.severite)
                                      .withValues(alpha: 0.15),
                              child: Icon(Icons.warning_amber,
                                  color: AppTheme.severiteColor(inc.severite),
                                  size: 20),
                            ),
                            title: Text(
                                '${inc.siteNom ?? '—'} · ${kTypeIncident[inc.type] ?? inc.type}',
                                style: const TextStyle(
                                    fontWeight: FontWeight.w600)),
                            subtitle: Text(
                                '${inc.description}\n${fmtDateTime(inc.dateOuverture)}',
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis),
                            isThreeLine: true,
                            trailing: StatusChip(
                                label:
                                    kStatutIncident[inc.statut] ?? inc.statut,
                                color: AppTheme.severiteColor(inc.severite)),
                            onTap: () async {
                              await context.push('/incidents/${inc.id}');
                              if (context.mounted) _reload(context);
                            },
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
