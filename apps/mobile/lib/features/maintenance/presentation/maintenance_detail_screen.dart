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

  Future<void> _close(Maintenance m) async {
    final repo = context.read<MaintenanceRepository>();
    final uploadService = context.read<UploadService>();
    final navigator = Navigator.of(context);

    // Formulaire de clôture (observations + relevés énergie si maintenance passive)
    final result = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _CloseSheet(maintenance: m),
    );
    if (result == null) return;

    setState(() => _busy = true);

    // Signature optionnelle
    String? signatureKey;
    final bytes = await navigator.push<dynamic>(
      MaterialPageRoute(builder: (_) => const SignaturePadScreen()),
    );
    if (bytes != null) {
      signatureKey = await uploadService.uploadImage(bytes, 'signature-${widget.id}.png');
    }

    final res = await repo.close(
      widget.id,
      observations: result['observations'] as String?,
      signaturePath: signatureKey,
      energie: result['energie'] as Map<String, dynamic>?,
    );
    if (!mounted) return;
    setState(() => _busy = false);
    _snack(res.isQueued ? 'Clôture mise en file (hors-ligne)' : 'Maintenance clôturée');
    _reload();
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
                    _row('Catégorie', '${kCategorieEquipement[m.categorie] ?? m.categorie}${m.isPassive ? ' · passive' : ' · active'}'),
                    _row('Technicien', m.technicien ?? '—'),
                    if (m.prestataire != null) _row('Prestataire', m.prestataire!),
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
                FilledButton.icon(onPressed: _busy ? null : () => _close(m), icon: const Icon(Icons.check_circle), label: const Text('Clôturer')),
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

/// Sources d'énergie présentes selon la configuration du site (aligné sur l'API).
List<String> sourcesForConfig(String? config) {
  switch (config) {
    case 'CEET_GE':
    case 'HYBRIDE_CEET_GE':
      return ['CEET', 'GE'];
    case 'CEET_UNIQUEMENT':
      return ['CEET'];
    case 'GE_UNIQUEMENT':
      return ['GE'];
    case 'HYBRIDE_GE':
      return ['GE', 'SOLAIRE'];
    case 'SOLAIRE_UNIQUEMENT':
      return ['SOLAIRE'];
    default:
      return [];
  }
}

/// Formulaire de clôture : observations + relevés énergie (obligatoires si maintenance passive).
class _CloseSheet extends StatefulWidget {
  final Maintenance maintenance;
  const _CloseSheet({required this.maintenance});

  @override
  State<_CloseSheet> createState() => _CloseSheetState();
}

class _CloseSheetState extends State<_CloseSheet> {
  final _obs = TextEditingController();
  final _gasoil = TextEditingController();
  final _heures = TextEditingController();
  final _index = TextEditingController();
  final _kwh = TextEditingController();
  final _puissance = TextEditingController();
  String? _error;

  @override
  void dispose() {
    for (final c in [_obs, _gasoil, _heures, _index, _kwh, _puissance]) {
      c.dispose();
    }
    super.dispose();
  }

  double? _num(TextEditingController c) =>
      c.text.trim().isEmpty ? null : double.tryParse(c.text.replaceAll(',', '.'));

  void _submit() {
    final m = widget.maintenance;
    final sources = m.isPassive ? sourcesForConfig(m.sitePowerConfig) : <String>[];
    final energie = <String, dynamic>{};

    if (sources.contains('GE')) {
      if (_num(_gasoil) == null || _num(_heures) == null) {
        setState(() => _error = 'Renseignez le volume gasoil et les heures de fonctionnement GE.');
        return;
      }
      energie['volumeGasoilLitres'] = _num(_gasoil);
      energie['heuresFonctGE'] = _num(_heures);
    }
    if (sources.contains('CEET')) {
      if (_num(_index) == null) {
        setState(() => _error = "Renseignez l'index compteur CEET.");
        return;
      }
      energie['indexCompteur'] = _num(_index);
      if (_num(_kwh) != null) energie['consommationKwh'] = _num(_kwh);
    }
    if (sources.contains('SOLAIRE')) {
      if (_num(_puissance) == null) {
        setState(() => _error = 'Renseignez la puissance solaire.');
        return;
      }
      energie['puissanceKva'] = _num(_puissance);
    }

    Navigator.pop(context, {'observations': _obs.text.trim(), 'energie': energie});
  }

  @override
  Widget build(BuildContext context) {
    final m = widget.maintenance;
    final sources = m.isPassive ? sourcesForConfig(m.sitePowerConfig) : <String>[];
    const numKb = TextInputType.numberWithOptions(decimal: true);

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Clôturer la maintenance', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            if (sources.isNotEmpty) ...[
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: Colors.blue.shade50, borderRadius: BorderRadius.circular(10)),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Relevés énergie requis (${m.sitePowerConfig})',
                        style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Colors.blue.shade800)),
                    const SizedBox(height: 10),
                    if (sources.contains('GE')) ...[
                      TextField(controller: _gasoil, keyboardType: numKb, decoration: const InputDecoration(labelText: 'Volume gasoil (L) *')),
                      const SizedBox(height: 10),
                      TextField(controller: _heures, keyboardType: numKb, decoration: const InputDecoration(labelText: 'Heures fonctionnement GE *')),
                      const SizedBox(height: 10),
                    ],
                    if (sources.contains('CEET')) ...[
                      TextField(controller: _index, keyboardType: numKb, decoration: const InputDecoration(labelText: 'Index compteur CEET *')),
                      const SizedBox(height: 10),
                      TextField(controller: _kwh, keyboardType: numKb, decoration: const InputDecoration(labelText: 'Consommation (kWh)')),
                      const SizedBox(height: 10),
                    ],
                    if (sources.contains('SOLAIRE'))
                      TextField(controller: _puissance, keyboardType: numKb, decoration: const InputDecoration(labelText: 'Puissance solaire (kVA) *')),
                  ],
                ),
              ),
              const SizedBox(height: 12),
            ],
            TextField(controller: _obs, maxLines: 3, decoration: const InputDecoration(labelText: 'Observations / travaux réalisés')),
            if (_error != null)
              Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error!, style: const TextStyle(color: Colors.red, fontSize: 12))),
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              child: FilledButton(onPressed: _submit, child: const Text('Continuer (signature)')),
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }
}
