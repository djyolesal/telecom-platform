import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import '../../../core/bloc/list_cubit.dart';
import '../../../core/widgets/common_widgets.dart';
import '../../../core/constants/enums.dart';
import '../../../core/utils/formatters.dart';
import '../data/releve_model.dart';
import '../data/releve_repository.dart';

class ReleveListScreen extends StatelessWidget {
  const ReleveListScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final repo = context.read<ReleveRepository>();
    return BlocProvider(
      create: (_) => ListCubit<Releve>()..run(() => repo.getReleves()),
      child: const _ReleveView(),
    );
  }
}

class _ReleveView extends StatelessWidget {
  const _ReleveView();

  void _reload(BuildContext context) {
    final repo = context.read<ReleveRepository>();
    context.read<ListCubit<Releve>>().run(() => repo.getReleves());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Relevés énergie')),
      body: BlocBuilder<ListCubit<Releve>, ListState<Releve>>(
        builder: (context, state) {
          if (state.status == ResourceStatus.loading) return const LoadingView();
          if (state.status == ResourceStatus.failure) {
            return ErrorView(message: state.error ?? 'Erreur', onRetry: () => _reload(context));
          }
          if (state.items.isEmpty) {
            return const EmptyView(title: 'Aucun relevé', hint: 'Les relevés sont enregistrés à la clôture des maintenances.');
          }
          return RefreshIndicator(
            onRefresh: () async => _reload(context),
            child: ListView.separated(
              itemCount: state.items.length,
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemBuilder: (context, i) {
                final r = state.items[i];
                final detail = r.source == 'GE'
                    ? '${fmtLitres(r.volumeGasoilLitres)} · ${fmtNum(r.heuresFonctGE)} h'
                    : '${fmtNum(r.consommationKwh)} kWh';
                return ListTile(
                  leading: const CircleAvatar(child: Icon(Icons.bolt, size: 20)),
                  title: Text('${r.siteNom ?? r.siteCode ?? '—'} · ${kSourceEnergie[r.source] ?? r.source}', style: const TextStyle(fontWeight: FontWeight.w600)),
                  subtitle: Text('${fmtDate(r.dateReleve)} · $detail'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => context.push('/energie/detail/${r.id}'),
                );
              },
            ),
          );
        },
      ),
    );
  }
}
