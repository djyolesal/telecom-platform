import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import '../../../core/bloc/list_cubit.dart';
import '../../../core/widgets/common_widgets.dart';
import '../../../core/widgets/barre_recherche.dart';
import '../../../core/utils/formatters.dart';
import '../data/depotage_model.dart';
import '../data/bon_livraison_repository.dart';

const _moisLabels = ['', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

/// Couleurs d'état d'un chargement, alignées sur le portail web.
const _statutCouleurs = <String, Color>{
  'PLANIFIE': Color(0xFFB45309),
  'CHARGE': Color(0xFF1D4ED8),
  'LIVRE': Color(0xFF15803D),
  'ANNULE': Color(0xFFB91C1C),
};

/// « Mes chargements » — les bons de livraison du transporteur connecté.
/// L'API filtre déjà sur son prestataire : il ne voit jamais ceux d'un confrère.
class BlListScreen extends StatelessWidget {
  const BlListScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final repo = context.read<BonLivraisonRepository>();
    return BlocProvider(
      create: (_) => ListCubit<BonLivraisonLite>()..run(repo.getMesBonsLivraison),
      child: const _BlListView(),
    );
  }
}

class _BlListView extends StatefulWidget {
  const _BlListView();

  @override
  State<_BlListView> createState() => _BlListViewState();
}

class _BlListViewState extends State<_BlListView> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final repo = context.read<BonLivraisonRepository>();
    void recharger() => context.read<ListCubit<BonLivraisonLite>>().run(repo.getMesBonsLivraison);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Mes chargements'),
        actions: [IconButton(onPressed: recharger, icon: const Icon(Icons.refresh))],
        bottom: BarreRecherche(
          hint: 'Rechercher (N° BL, camion)…',
          onChanged: (q) => setState(() => _query = q),
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          await context.push('/carburant/bon-livraison/nouveau');
          if (context.mounted) recharger();
        },
        icon: const Icon(Icons.add),
        label: const Text('Nouveau BL'),
      ),
      body: BlocBuilder<ListCubit<BonLivraisonLite>, ListState<BonLivraisonLite>>(
        builder: (context, state) {
          if (state.status == ResourceStatus.loading) return const LoadingView();
          if (state.status == ResourceStatus.failure) {
            return ErrorView(message: state.error ?? 'Erreur', onRetry: recharger);
          }
          final q = _query.toLowerCase();
          final items = q.isEmpty
              ? state.items
              : state.items
                  .where((b) => b.numeroBL.toLowerCase().contains(q) || b.immatriculation.toLowerCase().contains(q))
                  .toList();
          if (items.isEmpty) {
            return EmptyView(
              icon: Icons.local_shipping_outlined,
              title: q.isEmpty ? 'Aucun chargement' : 'Aucun résultat',
              hint: q.isEmpty ? 'Vos bons de livraison apparaîtront ici.' : 'Aucun chargement ne correspond à « $_query ».',
            );
          }
          return RefreshIndicator(
            onRefresh: () async => recharger(),
            child: ListView.separated(
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 88),
              itemCount: items.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (context, i) => _CarteBl(bl: items[i]),
            ),
          );
        },
      ),
    );
  }
}

class _CarteBl extends StatelessWidget {
  final BonLivraisonLite bl;
  const _CarteBl({required this.bl});

  @override
  Widget build(BuildContext context) {
    final couleur = _statutCouleurs[bl.statut] ?? Colors.grey;
    return Card(
      margin: EdgeInsets.zero,
      child: ListTile(
        onTap: () => context.push('/carburant/bon-livraison/${bl.id}'),
        leading: CircleAvatar(
          backgroundColor: couleur.withValues(alpha: 0.12),
          child: Icon(Icons.local_shipping, color: couleur, size: 20),
        ),
        title: Text(bl.numeroBL, style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 2),
            Text('${bl.immatriculation} · ${_moisLabels[bl.mois.clamp(0, 12)]} ${bl.annee}'),
            Text(
              '${fmtLitres(bl.volumeChargeLitres)} chargés'
              '${bl.nbSites > 0 ? ' · ${bl.nbSites} site(s) au plan' : ' · plan à définir'}',
              style: TextStyle(fontSize: 12, color: Colors.grey.shade600),
            ),
          ],
        ),
        isThreeLine: true,
        trailing: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          decoration: BoxDecoration(color: couleur.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(20)),
          child: Text(bl.statut, style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: couleur)),
        ),
      ),
    );
  }
}
