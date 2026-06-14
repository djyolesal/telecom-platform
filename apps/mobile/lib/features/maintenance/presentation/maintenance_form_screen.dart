import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import '../../../core/constants/enums.dart';
import '../../../core/services/location_service.dart';
import '../../../core/sync/sync_service.dart';
import '../../../core/utils/formatters.dart';
import '../../../core/widgets/site_picker.dart';
import '../data/maintenance_repository.dart';

class MaintenanceFormScreen extends StatefulWidget {
  final String? initialSiteId;
  const MaintenanceFormScreen({super.key, this.initialSiteId});

  @override
  State<MaintenanceFormScreen> createState() => _MaintenanceFormScreenState();
}

class _MaintenanceFormScreenState extends State<MaintenanceFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _equipement = TextEditingController();
  final _description = TextEditingController();

  String? _siteId;
  String _type = 'PREVENTIVE';
  String _categorie = 'GE';
  DateTime _datePlanifiee = DateTime.now();
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _siteId = widget.initialSiteId;
  }

  @override
  void dispose() {
    _equipement.dispose();
    _description.dispose();
    super.dispose();
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
    final repo = context.read<MaintenanceRepository>();
    setState(() => _saving = true);

    final pos = await LocationService().currentPosition();
    final res = await repo.create(
          siteId: _siteId!,
          type: _type,
          categorie: _categorie,
          equipement: _equipement.text.trim(),
          description: _description.text.trim(),
          datePlanifiee: _datePlanifiee,
          latitude: pos?.lat,
          longitude: pos?.lng,
        );

    if (!mounted) return;
    setState(() => _saving = false);
    _showResult(res);
    context.pop();
  }

  void _showResult(SubmitResult res) {
    final msg = res.isQueued
        ? 'Hors-ligne : maintenance enregistrée et mise en file de synchronisation'
        : 'Maintenance planifiée';
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
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
            SitePicker(initialSiteId: _siteId, onChanged: (v) => _siteId = v),
            const SizedBox(height: 14),
            DropdownButtonFormField<String>(
              value: _type,
              decoration: const InputDecoration(labelText: 'Type'),
              items: kTypeMaintenance.entries.map((e) => DropdownMenuItem(value: e.key, child: Text(e.value))).toList(),
              onChanged: (v) => setState(() => _type = v!),
            ),
            const SizedBox(height: 14),
            DropdownButtonFormField<String>(
              value: _categorie,
              decoration: const InputDecoration(labelText: 'Catégorie équipement'),
              items: kCategorieEquipement.entries.map((e) => DropdownMenuItem(value: e.key, child: Text(e.value))).toList(),
              onChanged: (v) => setState(() => _categorie = v!),
            ),
            const SizedBox(height: 14),
            TextFormField(
              controller: _equipement,
              decoration: const InputDecoration(labelText: 'Équipement *', hintText: 'GE Perkins 60kVA'),
              validator: (v) => (v == null || v.isEmpty) ? 'Requis' : null,
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
