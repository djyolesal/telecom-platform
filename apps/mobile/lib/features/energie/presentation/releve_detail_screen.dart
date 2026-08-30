import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import '../../../core/widgets/common_widgets.dart';
import '../../../core/constants/enums.dart';
import '../../../core/utils/formatters.dart';
import '../data/releve_model.dart';
import '../data/releve_repository.dart';
import '../../../core/theme/app_theme.dart';

class ReleveDetailScreen extends StatefulWidget {
  final String id;
  const ReleveDetailScreen({super.key, required this.id});

  @override
  State<ReleveDetailScreen> createState() => _ReleveDetailScreenState();
}

class _ReleveDetailScreenState extends State<ReleveDetailScreen> {
  late Future<ReleveDetail> _future;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    _future = context.read<ReleveRepository>().getById(widget.id);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Détail relevé')),
      body: FutureBuilder<ReleveDetail>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const LoadingView();
          }
          if (snap.hasError || !snap.hasData) {
            return ErrorView(
                message: 'Détail indisponible (connexion requise)',
                onRetry: () => setState(_load));
          }
          final r = snap.data!;
          return ListView(
            padding: paddingEcran(context),
            children: [
              _card('Relevé', [
                _row('Site', r.siteNom ?? '—'),
                _row('Date', fmtDateTime(r.dateReleve)),
                if (r.provenance != null && r.provenance!.isNotEmpty)
                  _row('Provenance', r.provenance!),
                _row('Source', r.source),
                if (r.indexCompteur != null)
                  _row('Index compteur', fmtNum(r.indexCompteur!)),
                if (r.consommationKwh != null)
                  _row('Consommation', '${fmtNum(r.consommationKwh!)} kWh'),
                if (r.volumeGasoilLitres != null)
                  _row('Niveau cuve', '${fmtNum(r.volumeGasoilLitres!)} L'),
                if (r.gasoilConsommeLitres != null)
                  _row('Gasoil consommé',
                      '${fmtNum(r.gasoilConsommeLitres!)} L'),
                if (r.heuresFonctGE != null)
                  _row('Heures GE', '${fmtNum(r.heuresFonctGE!)} h'),
                if (r.groupeNumero != null)
                  _row('Groupe électrogène', 'GE n°${r.groupeNumero}'),
                if (r.puissanceKva != null)
                  _row('Puissance solaire', '${fmtNum(r.puissanceKva!)} kVA'),
                if (r.coutEstime != null)
                  _row('Coût estimé', fmtFcfa(r.coutEstime)),
                if (r.technicienNom != null && r.technicienNom!.isNotEmpty)
                  _row('Technicien', r.technicienNom!),
              ]),
              if (r.observations != null && r.observations!.isNotEmpty)
                _card('Observations', [
                  Text(r.observations!, style: const TextStyle(fontSize: 14))
                ]),
              if (r.maintenanceId != null)
                Card(
                  margin: const EdgeInsets.only(bottom: 12),
                  child: ListTile(
                    leading: const Icon(Icons.build),
                    title: const Text('Maintenance d\'origine'),
                    subtitle: Text([
                      kTypeMaintenance[r.maintenanceType] ?? r.maintenanceType,
                      r.maintenanceEquipement
                    ].where((e) => e != null && e.isNotEmpty).join(' · ')),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () =>
                        context.push('/maintenance/${r.maintenanceId}'),
                  ),
                ),
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
            Expanded(
                flex: 5,
                child: Text(label,
                    style:
                        TextStyle(color: Colors.grey.shade600, fontSize: 13))),
            Expanded(
                flex: 4,
                child: Text(value,
                    textAlign: TextAlign.right,
                    style: const TextStyle(
                        fontWeight: FontWeight.w500, fontSize: 13))),
          ],
        ),
      );
}
