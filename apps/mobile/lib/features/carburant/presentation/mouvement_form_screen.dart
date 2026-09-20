import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import '../../../core/config/app_config.dart';
import '../../../core/errors/exceptions.dart';
import '../../../core/services/gps_gate.dart';
import '../../../core/sync/attachment_store.dart';
import '../../../core/sync/photo_draft.dart';
import '../../../core/widgets/signature_pad.dart';
import '../../../core/widgets/site_picker.dart';
import '../../sites/data/site_model.dart';
import '../../sites/data/site_repository.dart';
import '../data/mouvement_repository.dart';

/// DÉCLARATION D'UN MOUVEMENT DE CARBURANT DEPUIS LE TERRAIN.
///
/// Un transfert ou une purge retire du gasoil du stock attendu — donc de
/// l'écart qui déclenche les alertes de vol. Déclarés au bureau, c'étaient les
/// écritures les moins prouvées de la chaîne.
///
/// Ce que le technicien fait ici : il CONSTATE et il PROUVE (sur site,
/// photos, signature). Ce qu'il ne fait pas : décider. Le serveur enregistre
/// la déclaration EN ATTENTE, sans aucun effet sur le stock, jusqu'à ce qu'un
/// responsable la valide. L'écran le dit explicitement — sinon le technicien
/// croirait la cuve corrigée et s'étonnerait de voir l'alerte persister.
class MouvementFormScreen extends StatefulWidget {
  final String? initialSiteId;
  const MouvementFormScreen({super.key, this.initialSiteId});

  @override
  State<MouvementFormScreen> createState() => _MouvementFormScreenState();
}

class _MouvementFormScreenState extends State<MouvementFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _volume = TextEditingController();
  final _motif = TextEditingController();
  final _picker = ImagePicker();

  String _type = 'PURGE'; // PURGE | TRANSFERT
  String? _siteId;
  String? _destinationId;
  final List<String> _photos = [];
  String? _signature;
  bool _envoi = false;

  static const _cleBrouillon = 'mouvement:nouveau';

  @override
  void initState() {
    super.initState();
    _siteId = widget.initialSiteId;
    // Android peut détruire l'activité pendant la prise de vue : les photos
    // déjà prises sont retrouvées au lieu d'être à refaire.
    _photos.addAll(PhotoDraft.lire(_cleBrouillon));
  }

  @override
  void dispose() {
    _volume.dispose();
    _motif.dispose();
    super.dispose();
  }

  Future<void> _prendrePhoto() async {
    try {
      final shot = await _picker.pickImage(
          source: ImageSource.camera, maxWidth: 1600, maxHeight: 1600, imageQuality: 70);
      if (shot == null) return;
      final chemin = await AttachmentStore.persistFile(shot.path);
      if (!mounted) return;
      setState(() => _photos.add(chemin));
      await PhotoDraft.ecrire(_cleBrouillon, _photos);
    } catch (_) {/* annulé / permission refusée */}
  }

  Future<void> _signer() async {
    final bytes = await Navigator.of(context)
        .push<Object?>(MaterialPageRoute(builder: (_) => const SignaturePadScreen()));
    if (bytes is! Uint8List) return;
    final chemin = await AttachmentStore.persistBytes(bytes, 'mouvement-signature.png');
    if (!mounted) return;
    setState(() => _signature = chemin);
  }

  Future<void> _enregistrer() async {
    if (!(_formKey.currentState?.validate() ?? false) || _siteId == null) return;
    if (_type == 'TRANSFERT' && _destinationId == null) {
      _snack('Choisissez le site qui reçoit le carburant.');
      return;
    }
    final minPhotos = AppConfig.minPhotosMouvementCarburant;
    if (_photos.length < minPhotos) {
      _snack('Photographiez la cuve : $minPhotos photo(s) minimum (${_photos.length} prise(s)).');
      return;
    }
    if (_signature == null) {
      _snack('Votre signature est requise pour déclarer ce mouvement.');
      return;
    }

    // Dépôt résolu AVANT tout await : y revenir après la vérification GPS
    // utiliserait un contexte qui a pu être démonté entre-temps.
    final repo = context.read<MouvementRepository>();
    final siteRepo = context.read<SiteRepository>();
    setState(() => _envoi = true);
    try {
      // Fiche du site depuis le CACHE hors-ligne : sans ses coordonnées, la
      // vérification de présence ne peut pas se faire localement.
      Site? site;
      try {
        for (final s in await siteRepo.getSites()) {
          if (s.id == _siteId) { site = s; break; }
        }
      } catch (_) {/* cache indisponible : le serveur tranchera */}
      if (!mounted) return;
      // Le carburant PART d'ici : la position se vérifie sur le site de départ.
      final check = await positionVerifiee(context,
          siteLat: site?.latitude,
          siteLng: site?.longitude,
          siteNom: site?.nom,
          action: 'la déclaration du mouvement');
      if (!check.ok) return;

      final volume = num.tryParse(_volume.text.trim().replaceAll(',', '.')) ?? 0;
      final res = _type == 'PURGE'
          ? await repo.declarerPurge(
              siteId: _siteId!, volumeLitres: volume, motif: _motif.text.trim(),
              latitude: check.lat, longitude: check.lng,
              photoPaths: _photos, signaturePath: _signature)
          : await repo.declarerTransfert(
              siteSourceId: _siteId!, siteDestinationId: _destinationId!,
              volumeLitres: volume, motif: _motif.text.trim(),
              latitude: check.lat, longitude: check.lng,
              photoPaths: _photos, signaturePath: _signature);

      await PhotoDraft.effacer(_cleBrouillon);
      if (!mounted) return;
      _snack(res.isQueued
          ? 'Hors-ligne : déclaration mise en file, elle partira à la reconnexion'
          : 'Déclaration enregistrée — en attente de validation');
      GoRouter.of(context).pop();
    } catch (e) {
      if (mounted) _snack(e is ServerException ? e.message : 'Enregistrement impossible');
    } finally {
      if (mounted) setState(() => _envoi = false);
    }
  }

  void _snack(String m) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  @override
  Widget build(BuildContext context) {
    final minPhotos = AppConfig.minPhotosMouvementCarburant;

    return Scaffold(
      appBar: AppBar(title: const Text('Déclarer un mouvement')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // Dire d'emblée ce que cette déclaration fait — et ne fait pas.
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                  color: Colors.blue.shade50, borderRadius: BorderRadius.circular(10)),
              child: const Text(
                'Votre déclaration ne modifie pas le stock : elle part en attente '
                'de validation par un responsable. Photographiez la cuve, c\'est '
                'cette preuve qui sera examinée.',
                style: TextStyle(fontSize: 12),
              ),
            ),
            const SizedBox(height: 16),
            SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'PURGE', label: Text('Purge de cuve')),
                ButtonSegment(value: 'TRANSFERT', label: Text('Transfert')),
              ],
              selected: {_type},
              onSelectionChanged: (v) => setState(() => _type = v.first),
            ),
            const SizedBox(height: 16),
            SitePicker(
                initialSiteId: _siteId,
                onChanged: (v) => setState(() => _siteId = v)),
            if (_type == 'TRANSFERT') ...[
              const SizedBox(height: 14),
              const Text('Site qui reçoit le carburant',
                  style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
              const SizedBox(height: 6),
              SitePicker(
                  initialSiteId: _destinationId,
                  onChanged: (v) => setState(() => _destinationId = v)),
            ],
            const SizedBox(height: 14),
            TextFormField(
              controller: _volume,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'Volume (litres) *'),
              validator: (v) {
                final x = num.tryParse((v ?? '').trim().replaceAll(',', '.'));
                return (x == null || x <= 0) ? 'Volume requis' : null;
              },
            ),
            const SizedBox(height: 14),
            TextFormField(
              controller: _motif,
              maxLines: 3,
              decoration: const InputDecoration(
                  labelText: 'Motif *', alignLabelWithHint: true,
                  helperText: 'Ce que vous avez constaté, en une phrase'),
              validator: (v) =>
                  ((v ?? '').trim().length < 10) ? 'Motif requis (10 caractères minimum)' : null,
            ),
            const SizedBox(height: 18),
            Row(
              children: [
                Expanded(
                  child: Text('Photos de la cuve — ${_photos.length}/$minPhotos',
                      style: const TextStyle(fontWeight: FontWeight.w600)),
                ),
                OutlinedButton.icon(
                  onPressed: _envoi ? null : _prendrePhoto,
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
                      Stack(
                        children: [
                          ClipRRect(
                            borderRadius: BorderRadius.circular(6),
                            child: Image.file(File(_photos[i]),
                                width: 60, height: 60, fit: BoxFit.cover, cacheWidth: 160),
                          ),
                          Positioned(
                            top: -6,
                            right: -6,
                            child: IconButton(
                              icon: const Icon(Icons.cancel, size: 18, color: Colors.red),
                              onPressed: _envoi
                                  ? null
                                  : () {
                                      setState(() => _photos.removeAt(i));
                                      PhotoDraft.ecrire(_cleBrouillon, _photos);
                                    },
                            ),
                          ),
                        ],
                      ),
                  ],
                ),
              ),
            const SizedBox(height: 18),
            Row(
              children: [
                Expanded(
                  child: Text(_signature == null ? 'Signature requise' : 'Signature enregistrée',
                      style: TextStyle(
                          fontWeight: FontWeight.w600,
                          color: _signature == null ? Colors.orange.shade900 : Colors.green.shade800)),
                ),
                OutlinedButton.icon(
                  onPressed: _envoi ? null : _signer,
                  icon: const Icon(Icons.draw_outlined, size: 18),
                  label: Text(_signature == null ? 'Signer' : 'Re-signer'),
                ),
              ],
            ),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: _envoi ? null : _enregistrer,
              icon: _envoi
                  ? const SizedBox(
                      height: 18, width: 18,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Icon(Icons.send),
              label: Text(_envoi ? 'Envoi…' : 'Déclarer'),
            ),
          ],
        ),
      ),
    );
  }
}
