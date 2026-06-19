import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import '../../../core/services/location_service.dart';
import '../../../core/utils/formatters.dart';
import '../../../core/widgets/site_picker.dart';
import '../../sites/data/site_model.dart';
import '../../sites/data/site_repository.dart';
import '../data/maintenance_repository.dart';

class MaintenanceFormScreen extends StatefulWidget {
  final String? initialSiteId;
  const MaintenanceFormScreen({super.key, this.initialSiteId});

  @override
  State<MaintenanceFormScreen> createState() => _MaintenanceFormScreenState();
}

class _MaintenanceFormScreenState extends State<MaintenanceFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _description = TextEditingController();

  String? _siteId;
  String? _tacheKey;
  List<TacheSite> _taches = [];
  bool _loadingTaches = false;
  DateTime _datePlanifiee = DateTime.now();
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _siteId = widget.initialSiteId;
    if (_siteId != null) _loadTaches(_siteId!);
  }

  @override
  void dispose() {
    _description.dispose();
    super.dispose();
  }

  Future<void> _loadTaches(String siteId) async {
    setState(() { _loadingTaches = true; _taches = []; _tacheKey = null; });
    final repo = context.read<SiteRepository>();
    final taches = await repo.getTachesPreventives(siteId);
    if (!mounted) return;
    setState(() { _taches = taches; _loadingTaches = false; });
  }

  void _onSiteChanged(String? v) {
    _siteId = v;
    if (v != null) {
      _loadTaches(v);
    } else {
      setState(() { _taches = []; _tacheKey = null; });
    }
  }

  Future<void> _pickDate() async {
    final d = await showDatePicker(
      context: context,
      initialDate: _datePlanifiee,
      firstDate: DateTime.now().subtract(const Duration(days: 30)),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (d != null) setState(() => _datePlanifiee = d);
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false) || _siteId == null) return;
    TacheSite? tache;
    for (final t in _taches) {
      if (t.key == _tacheKey) { tache = t; break; }
    }
    if (tache == null) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Sélectionnez une tâche contractuelle')));
      return;
    }
    final repo = context.read<MaintenanceRepository>();
    final messenger = ScaffoldMessenger.of(context);
    final router = GoRouter.of(context);
    setState(() => _saving = true);
    try {
      final pos = await LocationService().currentPosition();
      final res = await repo.create(
        siteId: _siteId!,
        type: 'PREVENTIVE',
        categorie: tache.categorie,
        equipement: tache.libelle,
        tachePreventiveKey: tache.key,
        description: _description.text.trim(),
        datePlanifiee: _datePlanifiee,
        latitude: pos?.lat,
        longitude: pos?.lng,
      );
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(
        content: Text(res.isQueued
            ? 'Hors-ligne : maintenance enregistrée et mise en file de synchronisation'
            : 'Maintenance planifiée'),
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
      appBar: AppBar(title: const Text('Planifier une maintenance')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            SitePicker(initialSiteId: _siteId, onChanged: _onSiteChanged),
            const SizedBox(height: 14),
            DropdownButtonFormField<String>(
              initialValue: _tacheKey,
              isExpanded: true,
              decoration: InputDecoration(
                labelText: 'Tâche contractuelle *',
                hintText: _siteId == null ? 'Choisissez d\'abord un site' : null,
                suffixIcon: _loadingTaches
                    ? const Padding(padding: EdgeInsets.all(12), child: SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2)))
                    : null,
              ),
              items: _taches
                  .map((t) => DropdownMenuItem(value: t.key, child: Text('${t.libelle} (${t.frequenceLabel})', overflow: TextOverflow.ellipsis)))
                  .toList(),
              onChanged: _siteId == null ? null : (v) => setState(() => _tacheKey = v),
              validator: (v) => (v == null || v.isEmpty) ? 'Requis' : null,
            ),
            if (_siteId != null && !_loadingTaches && _taches.isEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text('Aucune tâche disponible (connexion requise, ou site sans tâche applicable).',
                    style: TextStyle(color: Colors.grey.shade600, fontSize: 12)),
              ),
            const SizedBox(height: 14),
            ListTile(
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: Colors.grey.shade300)),
              leading: const Icon(Icons.calendar_today, size: 20),
              title: const Text('Date planifiée'),
              subtitle: Text(fmtDate(_datePlanifiee)),
              onTap: _pickDate,
            ),
            const SizedBox(height: 14),
            TextFormField(
              controller: _description,
              maxLines: 3,
              decoration: const InputDecoration(labelText: 'Description', alignLabelWithHint: true),
            ),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: _saving ? null : _submit,
              icon: _saving
                  ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Icon(Icons.save),
              label: const Text('Enregistrer'),
            ),
          ],
        ),
      ),
    );
  }
}
