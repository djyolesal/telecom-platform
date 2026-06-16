import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import '../../../core/services/location_service.dart';
import '../../../core/widgets/site_picker.dart';
import '../data/depotage_repository.dart';

class DepotageFormScreen extends StatefulWidget {
  final String? initialSiteId;
  const DepotageFormScreen({super.key, this.initialSiteId});

  @override
  State<DepotageFormScreen> createState() => _DepotageFormScreenState();
}

class _DepotageFormScreenState extends State<DepotageFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _volume = TextEditingController();
  final _stockAvant = TextEditingController();
  final _fournisseur = TextEditingController();
  final _bon = TextEditingController();
  final _prix = TextEditingController();
  final _obs = TextEditingController();

  String? _siteId;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _siteId = widget.initialSiteId;
  }

  @override
  void dispose() {
    for (final c in [_volume, _stockAvant, _fournisseur, _bon, _prix, _obs]) {
      c.dispose();
    }
    super.dispose();
  }

  double? _num(TextEditingController c) => c.text.isEmpty ? null : double.tryParse(c.text.replaceAll(',', '.'));

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false) || _siteId == null) return;
    final repo = context.read<DepotageRepository>();
    final messenger = ScaffoldMessenger.of(context);
    final router = GoRouter.of(context);
    setState(() => _saving = true);
    try {
      final pos = await LocationService().currentPosition();
      final res = await repo.create(
        siteId: _siteId!,
        volumeLitres: _num(_volume) ?? 0,
        stockAvantLitres: _num(_stockAvant),
        fournisseur: _fournisseur.text.trim(),
        numeroBonLivraison: _bon.text.trim(),
        prixLitre: _num(_prix),
        observations: _obs.text.trim(),
        latitude: pos?.lat,
        longitude: pos?.lng,
      );
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(
        content: Text(res.isQueued ? 'Hors-ligne : dépotage mis en file de synchronisation' : 'Dépotage enregistré'),
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
    return Scaffold(
      appBar: AppBar(title: const Text('Nouveau dépotage')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            SitePicker(initialSiteId: _siteId, onChanged: (v) => _siteId = v),
            const SizedBox(height: 14),
            TextFormField(
              controller: _volume,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'Volume livré (litres) *', prefixIcon: Icon(Icons.water_drop)),
              validator: (v) => (_num(_volume) == null || _num(_volume)! <= 0) ? 'Volume requis' : null,
            ),
            const SizedBox(height: 14),
            TextFormField(controller: _stockAvant, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Stock avant (litres)')),
            const SizedBox(height: 14),
            TextFormField(controller: _fournisseur, decoration: const InputDecoration(labelText: 'Fournisseur')),
            const SizedBox(height: 14),
            TextFormField(controller: _bon, decoration: const InputDecoration(labelText: 'N° bon de livraison')),
            const SizedBox(height: 14),
            TextFormField(controller: _prix, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Prix / litre (FCFA)')),
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
