import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import '../../../core/bloc/list_cubit.dart';
import '../../../core/widgets/common_widgets.dart';
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

class _IncidentsView extends StatelessWidget {
  const _IncidentsView();

  void _reload(BuildContext context) {
    final repo = context.read<IncidentRepository>();
    context.read<ListCubit<Incident>>().run(() => repo.getIncidents());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Incidents')),
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: AppColors.critique,
        onPressed: () async {
          await context.push('/incidents/nouveau');
          if (context.mounted) _reload(context);
        },
        icon: const Icon(Icons.add_alert),
        label: const Text('Déclarer'),
      ),
      body: BlocBuilder<ListCubit<Incident>, ListState<Incident>>(
        builder: (context, state) {
          if (state.status == ResourceStatus.loading) return const LoadingView();
          if (state.status == ResourceStatus.failure) {
            return ErrorView(message: state.error ?? 'Erreur', onRetry: () => _reload(context));
          }
          if (state.items.isEmpty) return const EmptyView(title: 'Aucun incident', icon: Icons.check_circle_outline);
          return RefreshIndicator(
            onRefresh: () async => _reload(context),
            child: ListView.separated(
              itemCount: state.items.length,
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemBuilder: (context, i) {
                final inc = state.items[i];
                return ListTile(
                  leading: CircleAvatar(
                    backgroundColor: AppTheme.severiteColor(inc.severite).withValues(alpha: 0.15),
                    child: Icon(Icons.warning_amber, color: AppTheme.severiteColor(inc.severite), size: 20),
                  ),
                  title: Text('${inc.siteCode ?? '—'} · ${kTypeIncident[inc.type] ?? inc.type}', style: const TextStyle(fontWeight: FontWeight.w600)),
                  subtitle: Text('${inc.description}\n${fmtDateTime(inc.dateOuverture)}', maxLines: 2, overflow: TextOverflow.ellipsis),
                  isThreeLine: true,
                  trailing: StatusChip(label: kStatutIncident[inc.statut] ?? inc.statut, color: AppTheme.severiteColor(inc.severite)),
                  onTap: () async {
                    await context.push('/incidents/${inc.id}');
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
