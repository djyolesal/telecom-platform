import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import '../../../core/bloc/list_cubit.dart';
import '../../../core/widgets/common_widgets.dart';
import '../../../core/constants/enums.dart';
import '../../../core/utils/formatters.dart';
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

class _MaintenanceView extends StatelessWidget {
  const _MaintenanceView();

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
    context.read<ListCubit<Maintenance>>().run(() => repo.getMaintenances());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Maintenances')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          await context.push('/maintenance/nouveau');
          if (context.mounted) _reload(context);
        },
        icon: const Icon(Icons.add),
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
                  title: Text('${m.siteCode ?? '—'} · ${m.equipement}', style: const TextStyle(fontWeight: FontWeight.w600)),
                  subtitle: Text(
                    '${kTypeMaintenance[m.type] ?? m.type} · ${fmtDate(m.datePlanifiee)}'
                    '${m.prestataire != null ? '\n${m.prestataire}' : ''}',
                  ),
                  isThreeLine: m.prestataire != null,
                  trailing: StatusChip(label: kStatutMaintenance[m.statut] ?? m.statut, color: _statutColor(m.statut)),
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
