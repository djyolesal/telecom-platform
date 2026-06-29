import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../core/widgets/common_widgets.dart';
import '../../../core/utils/formatters.dart';
import '../data/depotage_model.dart';
import '../data/depotage_repository.dart';

class DepotageDetailScreen extends StatefulWidget {
  final String id;
  const DepotageDetailScreen({super.key, required this.id});

  @override
  State<DepotageDetailScreen> createState() => _DepotageDetailScreenState();
}

class _DepotageDetailScreenState extends State<DepotageDetailScreen> {
  late Future<DepotageDetail> _future;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    final repo = context.read<DepotageRepository>();
    _future = repo.getById(widget.id);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Détail dépotage')),
      body: FutureBuilder<DepotageDetail>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) return const LoadingView();
          if (snap.hasError || !snap.hasData) {
            return ErrorView(message: 'Détail indisponible (connexion requise)', onRetry: () => setState(_load));
          }
          final d = snap.data!;
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _card('Livraison', [
                _row('Site', d.siteNom ?? d.siteCode ?? '—'),
                _row('Date', fmtDateTime(d.dateDepotage)),
                _row('Volume livré (jauge)', fmtLitres(d.volumeLitres)),
                _row('Stock avant', fmtLitres(d.stockAvantLitres)),
                _row('Stock après', fmtLitres(d.stockApresLitres)),
                if (d.fournisseur != null) _row('Fournisseur', d.fournisseur!),
                if (d.numeroBonLivraison != null) _row('Bon de livraison', d.numeroBonLivraison!),
                if (d.technicienNom != null && d.technicienNom!.isNotEmpty) _row('Technicien', d.technicienNom!),
              ]),
              if (d.volumeAnnonceLitres != null || d.ecartLivraisonLitres != null || d.ecartConsoLitres != null || d.analyseDepotage != null)
                _card('Réconciliation', [
                  if (d.volumeAnnonceLitres != null) _row('Volume annoncé (BL)', fmtLitres(d.volumeAnnonceLitres)),
                  _ecartRow('Écart livraison', d.ecartLivraisonLitres),
                  if (d.gasoilAttenduLitres != null) _row('Gasoil attendu', fmtLitres(d.gasoilAttenduLitres)),
                  _ecartRow('Écart conso', d.ecartConsoLitres),
                  if (d.analyseDepotage != null && d.analyseDepotage!.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(color: Colors.grey.shade100, borderRadius: BorderRadius.circular(8)),
                        child: Text(d.analyseDepotage!, style: const TextStyle(fontSize: 13)),
                      ),
                    ),
                ]),
              if (d.heuresGE.isNotEmpty)
                _card('Heures groupes électrogènes', [
                  for (final h in d.heuresGE)
                    _row(
                      h.numero != null
                          ? 'GE n°${h.numero} · ${h.puissanceKva?.toStringAsFixed(0) ?? '?'} kVA · ${h.statut == 'GE_PERMANENT' ? 'permanent' : 'secours'}'
                          : 'GE',
                      '${h.indexHeuresGE.toStringAsFixed(0)} h',
                    ),
                ]),
              if (d.observations != null && d.observations!.isNotEmpty)
                _card('Observations', [Text(d.observations!, style: const TextStyle(fontSize: 14))]),
              if (d.photoUrls.isNotEmpty)
                _card('Photos (${d.photoUrls.length})', [
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: d.photoUrls
                        .map((u) => ClipRRect(
                              borderRadius: BorderRadius.circular(8),
                              child: Image.network(u, width: 96, height: 96, fit: BoxFit.cover,
                                  errorBuilder: (_, __, ___) => Container(width: 96, height: 96, color: Colors.grey.shade200, child: const Icon(Icons.broken_image, color: Colors.grey))),
                            ))
                        .toList(),
                  ),
                ]),
            ],
          );
        },
      ),
    );
  }

  Widget _card(String title, List<Widget> children) => Card(
        margin: const EdgeInsets.only(bottom: 12),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: const TextStyle(fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              ...children,
            ],
          ),
        ),
      );

  Widget _row(String label, String value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(flex: 5, child: Text(label, style: TextStyle(color: Colors.grey.shade600, fontSize: 13))),
            Expanded(flex: 4, child: Text(value, textAlign: TextAlign.right, style: const TextStyle(fontWeight: FontWeight.w500, fontSize: 13))),
          ],
        ),
      );

  /// Écart signé avec code couleur (vert ≈ 0, rouge négatif/manquant, ambre surplus).
  Widget _ecartRow(String label, double? value) {
    if (value == null) return _row(label, '—');
    final color = value.abs() < 1 ? Colors.green.shade700 : value < 0 ? Colors.red.shade600 : Colors.amber.shade800;
    final signe = value > 0 ? '+' : '';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Expanded(flex: 5, child: Text(label, style: TextStyle(color: Colors.grey.shade600, fontSize: 13))),
          Expanded(flex: 4, child: Text('$signe${value.toStringAsFixed(0)} L', textAlign: TextAlign.right, style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13, color: color))),
        ],
      ),
    );
  }
}
