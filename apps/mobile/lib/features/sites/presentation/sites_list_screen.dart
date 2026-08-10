import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import '../../../core/bloc/list_cubit.dart';
import '../../../core/widgets/common_widgets.dart';
import '../../../core/theme/app_theme.dart';
import '../data/site_model.dart';
import '../data/site_repository.dart';

class SitesListScreen extends StatelessWidget {
  const SitesListScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final repo = context.read<SiteRepository>();
    return BlocProvider(
      create: (_) => ListCubit<Site>()..run(() => repo.getSites()),
      child: const _SitesView(),
    );
  }
}

class _SitesView extends StatefulWidget {
  const _SitesView();
  @override
  State<_SitesView> createState() => _SitesViewState();
}

class _SitesViewState extends State<_SitesView> {
  final _search = TextEditingController();

  void _reload() {
    final repo = context.read<SiteRepository>();
    context
        .read<ListCubit<Site>>()
        .run(() => repo.getSites(search: _search.text.trim()));
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Sites')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(12),
            child: TextField(
              controller: _search,
              decoration: InputDecoration(
                hintText: 'Rechercher (nom, région)…',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: IconButton(
                    icon: const Icon(Icons.tune), onPressed: _reload),
              ),
              onSubmitted: (_) => _reload(),
            ),
          ),
          Expanded(
            child: BlocBuilder<ListCubit<Site>, ListState<Site>>(
              builder: (context, state) {
                if (state.status == ResourceStatus.loading) {
                  return const LoadingView();
                }
                if (state.status == ResourceStatus.failure) {
                  return ErrorView(
                      message: state.error ?? 'Erreur', onRetry: _reload);
                }
                if (state.items.isEmpty) {
                  return const EmptyView(title: 'Aucun site');
                }
                return RefreshIndicator(
                  onRefresh: () async => _reload(),
                  child: ListView.separated(
                    itemCount: state.items.length,
                    separatorBuilder: (_, __) => const Divider(height: 1),
                    itemBuilder: (context, i) {
                      final s = state.items[i];
                      return ListTile(
                        leading: CircleAvatar(
                          backgroundColor:
                              AppColors.brand.withValues(alpha: 0.1),
                          child: const Icon(Icons.cell_tower,
                              color: AppColors.brand, size: 20),
                        ),
                        title: Text(s.nom,
                            style:
                                const TextStyle(fontWeight: FontWeight.w600)),
                        subtitle: Text(s.region),
                        trailing: Text(
                            '${s.puissanceGeKva.toStringAsFixed(0)} kVA',
                            style: TextStyle(
                                color: Colors.grey.shade500, fontSize: 12)),
                        onTap: () => context.push('/sites/${s.id}'),
                      );
                    },
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
