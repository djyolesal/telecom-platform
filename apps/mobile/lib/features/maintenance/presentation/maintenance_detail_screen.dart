import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../core/constants/enums.dart';
import '../../../core/services/location_service.dart';
import '../../../core/services/upload_service.dart';
import '../../../core/utils/formatters.dart';
import '../../../core/widgets/common_widgets.dart';
import '../../../core/widgets/signature_pad.dart';
import '../data/maintenance_model.dart';
import '../data/maintenance_repository.dart';

class MaintenanceDetailScreen extends StatefulWidget {
  final String id;
  const MaintenanceDetailScreen({super.key, required this.id});

  @override
  State<MaintenanceDetailScreen> createState() => _MaintenanceDetailScreenState();
}

class _MaintenanceDetailScreenState extends State<MaintenanceDetailScreen> {
  late Future<Maintenance> _future;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _future = context.read<MaintenanceRepository>().getMaintenance(widget.id);
  }

  void _reload() => setState(() => _future = context.read<MaintenanceRepository>().getMaintenance(widget.id));

  Future<void> _start() async {
    final repo = context.read<MaintenanceRepository>();
    setState(() => _busy = true);
    final pos = await LocationService().currentPosition();
    final res = await repo.start(widget.id, latitude: pos?.lat, longitude: pos?.lng);
    if (!mounted) return;
    setState(() => _busy = false);
    _snack(res.isQueued ? 'Démarrage mis en file (hors-ligne)' : 'Maintenance démarrée');
    _reload();
  }

  Future<void> _close() async {
    final repo = context.read<MaintenanceRepository>();
    final uploadService = context.read<UploadService>();
    final navigator = Navigator.of(context);

    final observations = await _askObservations();
    if (observations == null) return;

    setState(() => _busy = true);

    // Signature optionnelle
    String? signatureKey;
    final bytes = await navigator.push<dynamic>(
      MaterialPageRoute(builder: (_) => const SignaturePadScreen()),
    );
    if (bytes != null) {
      signatureKey = await uploadService.uploadImage(bytes, 'signature-${widget.id}.png');
    }

    final res = await repo.close(widget.id, observations: observations, signaturePath: signatureKey);
    if (!mounted) return;
    setState(() => _busy = false);
    _snack(res.isQueued ? 'Clôture mise en file (hors-ligne)' : 'Maintenance clôturée');
    _reload();
  }

  Future<String?> _askObservations() {
    final ctrl = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Clôturer la maintenance'),
        content: TextField(controller: ctrl, maxLines: 4, decoration: const InputDecoration(hintText: 'Observations / travaux réalisés')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Annuler')),
          FilledButton(onPressed: () => Navigator.pop(ctx, ctrl.text.trim()), child: const Text('Continuer')),
        ],
      ),
    );
  }

  void _snack(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Maintenance')),
      body: FutureBuilder<Maintenance>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) return const LoadingView();
          if (snap.hasError || !snap.hasData) return ErrorView(message: 'Indisponible', onRetry: _reload);
          final m = snap.data!;
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text('${m.siteCode ?? ''} · ${m.equipement}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              StatusChip(label: kStatutMaintenance[m.statut] ?? m.statut, color: Colors.blue),
              const SizedBox(height: 16),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(children: [
                    _row('Type', kTypeMaintenance[m.type] ?? m.type),
                    _row('Catégorie', kCategorieEquipement[m.categorie] ?? m.categorie),
                    _row('Technicien', m.technicien ?? '—'),
                    _row('Planifiée', fmtDateTime(m.datePlanifiee)),
                    _row('Début', fmtDateTime(m.dateDebut)),
                    _row('Fin', fmtDateTime(m.dateFin)),
                    if (m.dureeMinutes != null) _row('Durée', '${m.dureeMinutes} min'),
                  ]),
                ),
              ),
              if (m.description != null && m.description!.isNotEmpty) ...[
                const SizedBox(height: 8),
                Card(child: Padding(padding: const EdgeInsets.all(14), child: Text(m.description!))),
              ],
              const SizedBox(height: 16),
              if (m.statut == 'PLANIFIEE')
                FilledButton.icon(onPressed: _busy ? null : _start, icon: const Icon(Icons.play_arrow), label: const Text('Démarrer')),
              if (m.statut == 'EN_COURS')
                FilledButton.icon(onPressed: _busy ? null : _close, icon: const Icon(Icons.check_circle), label: const Text('Clôturer')),
            ],
          );
        },
      ),
    );
  }

  Widget _row(String label, String value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 5),
        child: Row(children: [
          Expanded(child: Text(label, style: TextStyle(color: Colors.grey.shade600, fontSize: 13))),
          Text(value, style: const TextStyle(fontWeight: FontWeight.w500, fontSize: 13)),
        ]),
      );
}
