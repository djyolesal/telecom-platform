import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import '../../../core/constants/enums.dart';
import '../../../core/services/location_service.dart';
import '../../../core/widgets/site_picker.dart';
import '../data/incident_repository.dart';

class IncidentFormScreen extends StatefulWidget {
  final String? initialSiteId;
  const IncidentFormScreen({super.key, this.initialSiteId});

  @override
  State<IncidentFormScreen> createState() => _IncidentFormScreenState();
}

class _IncidentFormScreenState extends State<IncidentFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _description = TextEditingController();
  String? _siteId;
  String _type = 'ALARME';
  String _severite = 'MAJEUR';
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _siteId = widget.initialSiteId;
  }

  @override
  void dispose() {
    _description.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false) || _siteId == null) return;
    final repo = context.read<IncidentRepository>();
    setState(() => _saving = true);
    final pos = await LocationService().currentPosition();
    final res = await repo.declare(
          siteId: _siteId!,
          type: _type,
          severite: _severite,
          description: _description.text.trim(),
          latitude: pos?.lat,
          longitude: pos?.lng,
        );
    if (!mounted) return;
    setState(() => _saving = false);
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(res.isQueued ? 'Hors-ligne : incident mis en file de synchronisation' : 'Incident déclaré'),
    ));
    context.pop();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Déclarer un incident')),
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
              items: kTypeIncident.entries.map((e) => DropdownMenuItem(value: e.key, child: Text(e.value))).toList(),
              onChanged: (v) => setState(() => _type = v!),
            ),
            const SizedBox(height: 14),
            DropdownButtonFormField<String>(
              value: _severite,
              decoration: const InputDecoration(labelText: 'Sévérité'),
              items: kSeverite.entries.map((e) => DropdownMenuItem(value: e.key, child: Text(e.value))).toList(),
              onChanged: (v) => setState(() => _severite = v!),
            ),
            const SizedBox(height: 14),
            TextFormField(
              controller: _description,
              maxLines: 4,
              decoration: const InputDecoration(labelText: 'Description *', alignLabelWithHint: true),
              validator: (v) => (v == null || v.isEmpty) ? 'Description requise' : null,
            ),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: _saving ? null : _submit,
              icon: _saving ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.send),
              label: const Text('Déclarer'),
            ),
          ],
        ),
      ),
    );
  }
}
