import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../../../core/config/app_config.dart';
import '../../../core/sync/attachment_store.dart';
import '../../../core/errors/exceptions.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import '../../../core/constants/enums.dart';
import '../../../core/services/location_service.dart';
import '../../../core/widgets/site_picker.dart';
import '../data/incident_repository.dart';
import '../../../core/theme/app_theme.dart';

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

  /// Photos de l'état constaté à la déclaration. Caméra uniquement, comme au
  /// démarrage : une photo de la galerie ne prouve ni le lieu ni l'instant.
  final List<String> _photos = [];

  Future<void> _prendrePhoto() async {
    final shot = await ImagePicker().pickImage(source: ImageSource.camera, imageQuality: 80);
    if (shot == null) return;
    final chemin = await AttachmentStore.persistFile(shot.path);
    if (!mounted) return;
    setState(() => _photos.add(chemin));
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false) || _siteId == null) {
      return;
    }
    // Le minimum vient du SERVEUR : on le contrôle ici pour éviter un
    // aller-retour inutile, mais c'est le serveur qui fait autorité.
    final minPhotos = AppConfig.minPhotosIncidentDeclaration;
    if (_photos.length < minPhotos) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text('Photographiez l\'état constaté : $minPhotos photo(s) minimum '
            '(${_photos.length} prise(s)).'),
      ));
      return;
    }
    final repo = context.read<IncidentRepository>();
    final messenger = ScaffoldMessenger.of(context);
    final router = GoRouter.of(context);
    setState(() => _saving = true);
    try {
      final pos = await LocationService().currentPosition();
      final res = await repo.declare(
        siteId: _siteId!,
        type: _type,
        severite: _severite,
        description: _description.text.trim(),
        latitude: pos?.lat,
        longitude: pos?.lng,
        photoPaths: _photos,
      );
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(
        content: Text(res.isQueued
            ? 'Hors-ligne : incident mis en file de synchronisation'
            : 'Incident déclaré'),
      ));
      router.pop();
    } catch (e) {
      if (mounted) {
        messenger.showSnackBar(SnackBar(
            content: Text(messageMetier(e,
                parDefaut:
                    'Enregistrement impossible - votre saisie est conservée, réessayez.')),
            backgroundColor: Colors.red));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Déclarer un incident')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: paddingEcran(context),
          children: [
            SitePicker(initialSiteId: _siteId, onChanged: (v) => _siteId = v),
            const SizedBox(height: 14),
            DropdownButtonFormField<String>(
              initialValue: _type,
              decoration: const InputDecoration(labelText: 'Type'),
              items: AppConfig.typesIncident.entries
                  .map((e) =>
                      DropdownMenuItem(value: e.key, child: Text(e.value)))
                  .toList(),
              onChanged: (v) => setState(() => _type = v!),
            ),
            const SizedBox(height: 14),
            DropdownButtonFormField<String>(
              initialValue: _severite,
              decoration: const InputDecoration(labelText: 'Sévérité'),
              items: kSeverite.entries
                  .map((e) =>
                      DropdownMenuItem(value: e.key, child: Text(e.value)))
                  .toList(),
              onChanged: (v) => setState(() => _severite = v!),
            ),
            const SizedBox(height: 14),
            TextFormField(
              controller: _description,
              maxLines: 4,
              decoration: const InputDecoration(
                  labelText: 'Description *', alignLabelWithHint: true),
              validator: (v) =>
                  (v == null || v.isEmpty) ? 'Description requise' : null,
            ),
            const SizedBox(height: 18),
            // ÉTAT CONSTATÉ. Celui qui déclare n'est pas forcément celui qui
            // interviendra : sans photo, rien ne documente ce qu'il a vu si la
            // prise en charge est reprise, décalée ou annulée. Le minimum vient
            // du serveur ; à 0, le bloc reste proposé mais n'oblige à rien.
            Row(
              children: [
                Expanded(
                  child: Text(
                    AppConfig.minPhotosIncidentDeclaration > 0
                        ? 'État constaté — ${_photos.length}/${AppConfig.minPhotosIncidentDeclaration} photo(s) minimum'
                        : 'État constaté — ${_photos.length} photo(s) (facultatif)',
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                ),
                OutlinedButton.icon(
                  onPressed: _saving ? null : _prendrePhoto,
                  icon: const Icon(Icons.photo_camera_outlined, size: 18),
                  label: const Text('Photo'),
                ),
              ],
            ),
            if (_photos.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (var i = 0; i < _photos.length; i++)
                      Chip(
                        label: Text('Photo ${i + 1}'),
                        onDeleted: _saving ? null : () => setState(() => _photos.removeAt(i)),
                      ),
                  ],
                ),
              ),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: _saving ? null : _submit,
              icon: _saving
                  ? const SizedBox(
                      height: 18,
                      width: 18,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white))
                  : const Icon(Icons.send),
              label: const Text('Déclarer'),
            ),
          ],
        ),
      ),
    );
  }
}
