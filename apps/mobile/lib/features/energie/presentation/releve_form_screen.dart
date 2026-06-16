import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import '../../../core/constants/enums.dart';
import '../../../core/services/location_service.dart';
import '../../../core/widgets/site_picker.dart';
import '../data/releve_repository.dart';

class ReleveFormScreen extends StatefulWidget {
  final String? initialSiteId;
  const ReleveFormScreen({super.key, this.initialSiteId});

  @override
  State<ReleveFormScreen> createState() => _ReleveFormScreenState();
}

class _ReleveFormScreenState extends State<ReleveFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _index = TextEditingController();
  final _kwh = TextEditingController();
  final _gasoil = TextEditingController();
  final _heures = TextEditingController();
  final _obs = TextEditingController();

  String? _siteId;
  String _source = 'CEET';
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _siteId = widget.initialSiteId;
  }

  @override
  void dispose() {
    for (final c in [_index, _kwh, _gasoil, _heures, _obs]) {
      c.dispose();
    }
    super.dispose();
  }

  double? _num(TextEditingController c) => c.text.isEmpty ? null : double.tryParse(c.text.replaceAll(',', '.'));

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false) || _siteId == null) return;
    final repo = context.read<ReleveRepository>();
    final messenger = ScaffoldMessenger.of(context);
    final router = GoRouter.of(context);
    setState(() => _saving = true);
    try {
      final pos = await LocationService().currentPosition();
      final res = await repo.create(
        siteId: _siteId!,
        source: _source,
        indexCompteur: _num(_index),
        consommationKwh: _num(_kwh),
        volumeGasoilLitres: _num(_gasoil),
        heuresFonctGE: _num(_heures),
        observations: _obs.text.trim(),
        latitude: pos?.lat,
        longitude: pos?.lng,
      );
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(
        content: Text(res.isQueued ? 'Hors-ligne : relevé mis en file de synchronisation' : 'Relevé enregistré'),
      ));
      router.pop();
    } catch (e) {
      if (mounted) messenger.showSnackBar(SnackBar(content: Text('Erreur : $e'), backgroundColor: Colors.red));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isGe = _source == 'GE';
    return Scaffold(
      appBar: AppBar(title: const Text('Nouveau relevé')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            SitePicker(initialSiteId: _siteId, onChanged: (v) => _siteId = v),
            const SizedBox(height: 14),
            DropdownButtonFormField<String>(
              initialValue: _source,
              decoration: const InputDecoration(labelText: 'Source'),
              items: kSourceEnergie.entries.map((e) => DropdownMenuItem(value: e.key, child: Text(e.value))).toList(),
              onChanged: (v) => setState(() => _source = v!),
            ),
            const SizedBox(height: 14),
            TextFormField(controller: _index, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Index compteur')),
            const SizedBox(height: 14),
            if (!isGe)
              TextFormField(controller: _kwh, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Consommation (kWh)')),
            if (isGe) ...[
              TextFormField(controller: _gasoil, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Volume gasoil (litres)')),
              const SizedBox(height: 14),
              TextFormField(controller: _heures, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Heures de fonctionnement GE')),
            ],
            const SizedBox(height: 14),
            TextFormField(controller: _obs, maxLines: 2, decoration: const InputDecoration(labelText: 'Observations')),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: _saving ? null : _submit,
              icon: _saving ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.save),
              label: const Text('Enregistrer'),
            ),
          ],
        ),
      ),
    );
  }
}
