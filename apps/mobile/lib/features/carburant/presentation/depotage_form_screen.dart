import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import '../../../core/services/location_service.dart';
import '../../../core/widgets/site_picker.dart';
import '../data/depotage_model.dart';
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

  // Plan de livraison prévu pour le site (chaîne BC → BL → plan).
  List<PlanLigne> _lignes = [];
  String? _ligneLivraisonId;
  bool _loadingLignes = false;

  @override
  void initState() {
    super.initState();
    _siteId = widget.initialSiteId;
    if (_siteId != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _loadLignes(_siteId!));
    }
  }

  Future<void> _onSiteChanged(String? siteId) async {
    setState(() {
      _siteId = siteId;
      _ligneLivraisonId = null;
      _lignes = [];
    });
    if (siteId != null) _loadLignes(siteId);
  }

  Future<void> _loadLignes(String siteId) async {
    final repo = context.read<DepotageRepository>();
    setState(() => _loadingLignes = true);
    try {
      final lignes = await repo.getLignesLivraison(siteId);
      if (!mounted) return;
      setState(() => _lignes = lignes);
    } catch (_) {
      // Le plan est optionnel : on n'interrompt pas la saisie en cas d'échec.
    } finally {
      if (mounted) setState(() => _loadingLignes = false);
    }
  }

  void _selectLigne(String? ligneId) {
    final l = ligneId == null ? null : _lignes.firstWhere((x) => x.id == ligneId);
    setState(() {
      _ligneLivraisonId = ligneId;
      if (l != null) {
        if (_volume.text.isEmpty) {
          final v = l.restant > 0 ? l.restant : l.volumePrevuLitres;
          _volume.text = v.toStringAsFixed(0);
        }
        if (_bon.text.isEmpty && l.numeroBL != null) _bon.text = l.numeroBL!;
      }
    });
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
        ligneLivraisonId: _ligneLivraisonId,
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
            SitePicker(initialSiteId: _siteId, onChanged: _onSiteChanged),
            const SizedBox(height: 14),
            if (_loadingLignes)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 8),
                child: LinearProgressIndicator(minHeight: 2),
              )
            else if (_lignes.isNotEmpty) ...[
              DropdownButtonFormField<String>(
                initialValue: _ligneLivraisonId,
                isExpanded: true,
                decoration: const InputDecoration(
                  labelText: 'Livraison planifiée pour ce site',
                  prefixIcon: Icon(Icons.local_shipping),
                ),
                items: [
                  const DropdownMenuItem<String>(value: null, child: Text('Hors plan (aucune)')),
                  ..._lignes.map((l) => DropdownMenuItem<String>(
                        value: l.id,
                        child: Text(
                          '${l.numeroBL ?? 'BL'} · ${l.volumePrevuLitres.toStringAsFixed(0)} L prévus',
                          overflow: TextOverflow.ellipsis,
                        ),
                      )),
                ],
                onChanged: _selectLigne,
              ),
              const SizedBox(height: 14),
            ],
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
