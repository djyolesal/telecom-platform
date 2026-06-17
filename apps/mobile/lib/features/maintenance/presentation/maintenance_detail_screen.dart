import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:image_picker/image_picker.dart';
import '../../../core/constants/enums.dart';
import '../../../core/services/location_service.dart';
import '../../../core/sync/attachment_store.dart';
import '../../../core/utils/formatters.dart';
import '../../../core/widgets/common_widgets.dart';
import '../../../core/widgets/photo_gallery.dart';
import '../../../core/widgets/signature_pad.dart';
import '../data/maintenance_model.dart';
import '../data/maintenance_repository.dart';

const kMinPhotosPreventive = 6;
const kGeofenceRadiusM = 20.0; // rayon toléré autour du site (aligné serveur)

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

  /// Vérifie la présence physique sur le site avant une opération.
  /// Retourne (ok, lat, lng). Si le site n'a pas de coordonnées, la vérification
  /// est ignorée (le serveur tranchera). Affiche un dialogue si hors site.
  Future<({bool ok, double? lat, double? lng})> _verifyOnSite(Maintenance m, String action) async {
    final pos = await LocationService().freshPosition();
    final hasSiteCoords = m.siteLatitude != null && m.siteLongitude != null;
    if (hasSiteCoords) {
      if (pos == null) {
        await _siteDialog('Position GPS indisponible',
            'Impossible de vérifier votre présence sur site pour $action. Activez la localisation (précision élevée) et réessayez.');
        return (ok: false, lat: null, lng: null);
      }
      final dist = LocationService.distanceMeters(pos.lat, pos.lng, m.siteLatitude!, m.siteLongitude!);
      if (dist > kGeofenceRadiusM) {
        await _siteDialog('Vous n\'êtes pas sur le site',
            'Vous êtes à ${dist.round()} m du site ${m.siteCode ?? ''}.\nRapprochez-vous à moins de ${kGeofenceRadiusM.round()} m pour $action.');
        return (ok: false, lat: null, lng: null);
      }
    }
    return (ok: true, lat: pos?.lat, lng: pos?.lng);
  }

  Future<void> _siteDialog(String title, String message) async {
    if (!mounted) return;
    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        icon: const Icon(Icons.location_off, color: Colors.red, size: 32),
        title: Text(title),
        content: Text(message),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Compris'))],
      ),
    );
  }

  Future<void> _start(Maintenance m) async {
    final repo = context.read<MaintenanceRepository>();
    setState(() => _busy = true);
    try {
      final check = await _verifyOnSite(m, 'le démarrage');
      if (!check.ok) return;
      final res = await repo.start(widget.id, latitude: check.lat, longitude: check.lng);
      if (!mounted) return;
      _snack(res.isQueued ? 'Démarrage mis en file (hors-ligne)' : 'Maintenance démarrée');
      _reload();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _close(Maintenance m) async {
    final repo = context.read<MaintenanceRepository>();
    final navigator = Navigator.of(context);

    // Formulaire de clôture (observations + énergie si passive + photos si préventive).
    // La feuille impose déjà ≥ kMinPhotosPreventive photos prises à la caméra.
    final result = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _CloseSheet(maintenance: m),
    );
    if (result == null) return;

    setState(() => _busy = true);
    try {
      // Vérification "sur site" obligatoire avant toute clôture.
      final check = await _verifyOnSite(m, 'la clôture');
      if (!check.ok) return;

      // Photos (caméra) → copie dans un stockage persistant. L'upload vers MinIO
      // est DIFFÉRÉ au moteur de sync : immédiat si en ligne, sinon à la reconnexion.
      final photoFiles = (result['photos'] as List?)?.cast<XFile>() ?? <XFile>[];
      final photoPaths = <String>[];
      for (final f in photoFiles) {
        photoPaths.add(await AttachmentStore.persistFile(f.path));
      }

      // Signature optionnelle → persistée localement (uploadée par la sync elle aussi).
      String? signaturePath;
      final bytes = await navigator.push<dynamic>(
        MaterialPageRoute(builder: (_) => const SignaturePadScreen()),
      );
      if (bytes != null) {
        signaturePath = await AttachmentStore.persistBytes(bytes as Uint8List, 'signature-${widget.id}.png');
      }

      final res = await repo.close(
        widget.id,
        observations: result['observations'] as String?,
        signatureLocalPath: signaturePath,
        energie: result['energie'] as Map<String, dynamic>?,
        photoPaths: photoPaths,
        latitude: check.lat,
        longitude: check.lng,
      );
      if (!mounted) return;
      _snack(res.isQueued
          ? 'Clôture enregistrée hors-ligne — photos envoyées dès la reconnexion'
          : 'Maintenance clôturée');
      _reload();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
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
              if (m.photoUrls.isNotEmpty) ...[
                const SizedBox(height: 8),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Photos (${m.photoUrls.length})',
                            style: TextStyle(fontWeight: FontWeight.w600, color: Colors.grey.shade700, fontSize: 13)),
                        const SizedBox(height: 10),
                        PhotoThumbnails(urls: m.photoUrls),
                      ],
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 16),
              if (m.statut == 'PLANIFIEE')
                FilledButton.icon(onPressed: _busy ? null : () => _start(m), icon: const Icon(Icons.play_arrow), label: const Text('Démarrer')),
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
  final _picker = ImagePicker();
  final List<XFile> _photos = [];
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

  /// Prise de photo SUR SITE uniquement (caméra). La galerie est volontairement
  /// désactivée : chaque photo doit être prise au moment de l'intervention.
  Future<void> _takePhoto() async {
    try {
      final img = await _picker.pickImage(source: ImageSource.camera, imageQuality: 70);
      if (img != null) setState(() => _photos.add(img));
    } catch (_) {/* annulé / permission refusée */}
  }

  void _submit() {
    final m = widget.maintenance;
    final sources = m.isPassive ? sourcesForConfig(m.sitePowerConfig) : <String>[];
    final energie = <String, dynamic>{};

    // Photos obligatoires pour une maintenance préventive
    if (m.type == 'PREVENTIVE' && _photos.length < kMinPhotosPreventive) {
      setState(() => _error = 'Au moins $kMinPhotosPreventive photos sont requises (${_photos.length} prise(s)).');
      return;
    }

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

    Navigator.pop(context, {'observations': _obs.text.trim(), 'energie': energie, 'photos': _photos});
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
            if (m.type == 'PREVENTIVE') ...[
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: _photos.length >= kMinPhotosPreventive ? Colors.green.shade50 : Colors.orange.shade50,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Photos ${_photos.length}/$kMinPhotosPreventive (carte GE, compteur CEET, activités)',
                        style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            color: _photos.length >= kMinPhotosPreventive ? Colors.green.shade800 : Colors.orange.shade900)),
                    Text('À prendre sur site avec la caméra — pas d\'import galerie',
                        style: TextStyle(fontSize: 11, color: Colors.grey.shade600)),
                    const SizedBox(height: 8),
                    if (_photos.isNotEmpty)
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: List.generate(_photos.length, (i) {
                          return Stack(
                            children: [
                              ClipRRect(
                                borderRadius: BorderRadius.circular(6),
                                child: Image.file(File(_photos[i].path), width: 60, height: 60, fit: BoxFit.cover),
                              ),
                              Positioned(
                                top: -6, right: -6,
                                child: IconButton(
                                  icon: const Icon(Icons.cancel, size: 18, color: Colors.red),
                                  onPressed: () => setState(() => _photos.removeAt(i)),
                                ),
                              ),
                            ],
                          );
                        }),
                      ),
                    const SizedBox(height: 4),
                    SizedBox(
                      width: double.infinity,
                      child: OutlinedButton.icon(
                        onPressed: _takePhoto,
                        icon: const Icon(Icons.camera_alt, size: 18),
                        label: const Text('Prendre une photo'),
                      ),
                    ),
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
