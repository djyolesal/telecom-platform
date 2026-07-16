import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:image_picker/image_picker.dart';
import '../../../core/config/app_config.dart';
import '../../../core/constants/enums.dart';
import '../../../core/errors/exceptions.dart';
import '../../../core/services/location_service.dart';
import '../../../core/sync/attachment_store.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/formatters.dart';
import '../../../core/widgets/common_widgets.dart';
import '../../../core/widgets/gps_refine_sheet.dart';
import '../../../core/widgets/photo_gallery.dart';
import '../data/incident_model.dart';
import '../data/incident_repository.dart';

/// Photos minimum (caméra, sur place) pour clôturer un incident.
const int kMinPhotosIncident = 6;

class IncidentDetailScreen extends StatefulWidget {
  final String id;
  const IncidentDetailScreen({super.key, required this.id});

  @override
  State<IncidentDetailScreen> createState() => _IncidentDetailScreenState();
}

class _IncidentDetailScreenState extends State<IncidentDetailScreen> {
  late Future<Incident> _future;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _future = context.read<IncidentRepository>().getIncident(widget.id);
  }

  void _reload() => setState(() {
        _future = context.read<IncidentRepository>().getIncident(widget.id);
      });

  void _snack(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  String _errMsg(Object e) {
    if (e is ServerException) return e.message; // ex : « Vous n'êtes pas sur le site… », photos < 6
    if (e is UnauthorizedException) return 'Session expirée — reconnectez-vous puis réessayez.';
    if (e is NetworkException) return 'Connexion indisponible — réessayez une fois en ligne.';
    return 'Erreur : $e';
  }

  /// Vérifie la présence physique sur le site (affinage GPS ~5 m, feuille avec
  /// loader — comme le dépotage). Si le site n'a pas de coordonnées, simple
  /// capture silencieuse (le serveur laisse passer). Retourne (ok, lat, lng).
  Future<({bool ok, double? lat, double? lng})> _verifyOnSite(Incident inc, String action) async {
    final hasSiteCoords = inc.siteLatitude != null && inc.siteLongitude != null;
    if (!hasSiteCoords) {
      final pos = await LocationService().freshPosition();
      return (ok: true, lat: pos?.lat, lng: pos?.lng);
    }
    final fix = await refineGpsPosition(context);
    if (fix == null) {
      await _siteDialog('Position GPS indisponible',
          'Impossible de vérifier votre présence sur site pour $action. Activez la localisation (précision élevée) et réessayez.');
      return (ok: false, lat: null, lng: null);
    }
    final dist = LocationService.distanceMeters(fix.lat, fix.lng, inc.siteLatitude!, inc.siteLongitude!);
    if (dist > AppConfig.geofenceRadiusM) {
      await _siteDialog('Vous n\'êtes pas sur le site',
          'Vous êtes à ${dist.round()} m${fix.accuracyM > 0 ? ' (± ${fix.accuracyM.round()} m)' : ''} du site ${inc.siteNom ?? inc.siteCode ?? ''}.\nRapprochez-vous à moins de ${AppConfig.geofenceRadiusM.round()} m pour $action.');
      return (ok: false, lat: null, lng: null);
    }
    return (ok: true, lat: fix.lat, lng: fix.lng);
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

  Future<void> _startFlow(Incident inc) async {
    final repo = context.read<IncidentRepository>();
    setState(() => _busy = true);
    try {
      final check = await _verifyOnSite(inc, 'le démarrage');
      if (!check.ok) return;
      final res = await repo.start(widget.id, latitude: check.lat, longitude: check.lng);
      if (!mounted) return;
      _snack(res.isQueued ? 'Démarrage mis en file — il partira à la reconnexion' : 'Intervention démarrée');
      _reload();
    } catch (e) {
      if (mounted) _snack(_errMsg(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _closeFlow(Incident inc) async {
    final repo = context.read<IncidentRepository>();

    // 1. Présence sur site AVANT la saisie (inutile de tout remplir hors site).
    setState(() => _busy = true);
    final check = await _verifyOnSite(inc, 'la clôture');
    if (mounted) setState(() => _busy = false);
    if (!check.ok || !mounted) return;

    // 2. Feuille de clôture : cause, action corrective, photos (≥ 6 au total).
    final result = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _CloseIncidentSheet(dejaPresentes: inc.photoUrls.length),
    );
    if (result == null || !mounted) return;

    setState(() => _busy = true);
    try {
      // Photos (caméra) → stockage persistant ; upload différé au moteur de sync.
      final photoFiles = (result['photos'] as List?)?.cast<XFile>() ?? <XFile>[];
      final photoPaths = <String>[];
      for (final f in photoFiles) {
        photoPaths.add(await AttachmentStore.persistFile(f.path));
      }

      final res = await repo.close(
        id: widget.id,
        dateResolution: DateTime.now(),
        causeProbable: result['causeProbable'] as String?,
        actionCorrective: result['actionCorrective'] as String?,
        creerMaintenance: result['creerMaintenance'] as bool? ?? false,
        agentPresent: result['agentPresent'] as bool,
        photoPaths: photoPaths,
        latitude: check.lat,
        longitude: check.lng,
      );
      if (!mounted) return;
      _snack(res.isQueued
          ? 'Clôture enregistrée hors-ligne — photos envoyées dès la reconnexion'
          : 'Incident clôturé');
      _reload();
    } catch (e) {
      if (mounted) _snack(_errMsg(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Incident')),
      body: FutureBuilder<Incident>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) return const LoadingView();
          if (snap.hasError || !snap.hasData) return ErrorView(message: 'Indisponible', onRetry: _reload);
          final inc = snap.data!;
          final resolu = inc.statut == 'RESOLU' || inc.statut == 'CLOS';
          final demarre = inc.dateIntervention != null && inc.statut == 'EN_COURS';
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text('${inc.siteNom ?? inc.siteCode ?? ''} · ${kTypeIncident[inc.type] ?? inc.type}',
                        style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                  ),
                  StatusChip(label: kSeverite[inc.severite] ?? inc.severite, color: AppTheme.severiteColor(inc.severite)),
                ],
              ),
              const SizedBox(height: 8),
              StatusChip(label: kStatutIncident[inc.statut] ?? inc.statut, color: Colors.blueGrey),
              const SizedBox(height: 16),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _row('Région', inc.region ?? '—'),
                      _row('Technicien', inc.technicien ?? '—'),
                      _row('Ouverture', fmtDateTime(inc.dateOuverture)),
                      if (inc.dateIntervention != null) _row('Intervention', fmtDateTime(inc.dateIntervention)),
                      const Divider(),
                      const Text('Description', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                      const SizedBox(height: 4),
                      Text(inc.description),
                      if (inc.causeProbable != null) ...[
                        const SizedBox(height: 8),
                        const Text('Cause probable', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                        Text(inc.causeProbable!),
                      ],
                      if (inc.actionCorrective != null) ...[
                        const SizedBox(height: 8),
                        const Text('Action corrective', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                        Text(inc.actionCorrective!),
                      ],
                    ],
                  ),
                ),
              ),
              if (inc.photoUrls.isNotEmpty) ...[
                const SizedBox(height: 16),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Photos (${inc.photoUrls.length})',
                            style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                        const SizedBox(height: 10),
                        PhotoThumbnails(urls: inc.photoUrls),
                      ],
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 16),
              // Cycle terrain : démarrer SUR SITE (GPS), puis clôturer SUR SITE
              // avec ≥ 6 photos prises à la caméra.
              if (!resolu && !demarre)
                FilledButton.icon(
                  onPressed: _busy ? null : () => _startFlow(inc),
                  icon: const Icon(Icons.play_arrow),
                  label: const Text('Démarrer l\'intervention'),
                ),
              if (demarre)
                FilledButton.icon(
                  onPressed: _busy ? null : () => _closeFlow(inc),
                  icon: const Icon(Icons.check_circle),
                  label: const Text('Clôturer l\'incident'),
                ),
            ],
          );
        },
      ),
    );
  }

  Widget _row(String label, String value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(children: [
          Expanded(child: Text(label, style: TextStyle(color: Colors.grey.shade600, fontSize: 13))),
          Text(value, style: const TextStyle(fontWeight: FontWeight.w500, fontSize: 13)),
        ]),
      );
}

/// Feuille de clôture d'un incident : cause, action corrective, maintenance
/// curative optionnelle et photos caméra (≥ [kMinPhotosIncident] au total,
/// photos déjà envoyées comprises).
class _CloseIncidentSheet extends StatefulWidget {
  final int dejaPresentes;
  const _CloseIncidentSheet({required this.dejaPresentes});

  @override
  State<_CloseIncidentSheet> createState() => _CloseIncidentSheetState();
}

class _CloseIncidentSheetState extends State<_CloseIncidentSheet> {
  final _cause = TextEditingController();
  final _action = TextEditingController();
  final _picker = ImagePicker();
  final List<XFile> _photos = [];
  bool _creerMaint = false;
  // Déclaration obligatoire : agent de gardiennage présent sur site ?
  bool? _agentPresent;
  String? _error;

  @override
  void dispose() {
    _cause.dispose();
    _action.dispose();
    super.dispose();
  }

  /// Prise de photo SUR SITE uniquement (caméra) — pas d'import galerie.
  Future<void> _takePhoto() async {
    try {
      // maxWidth/maxHeight bornent le redimensionnement natif : sans bornes,
      // image_picker recompresse la pleine résolution sur le thread principal
      // → ANR au bout de quelques photos.
      final img = await _picker.pickImage(
        source: ImageSource.camera,
        maxWidth: 1600,
        maxHeight: 1600,
        imageQuality: 70,
      );
      if (img != null) setState(() => _photos.add(img));
    } catch (_) {/* annulé / permission refusée */}
  }

  void _submit() {
    final total = widget.dejaPresentes + _photos.length;
    if (total < kMinPhotosIncident) {
      setState(() => _error =
          'Au moins $kMinPhotosIncident photos sont requises pour clôturer ($total fournie(s)).');
      return;
    }
    if (_agentPresent == null) {
      setState(() => _error = 'Indiquez si l\'agent de sécurité est présent sur le site.');
      return;
    }
    Navigator.pop(context, {
      'causeProbable': _cause.text.trim(),
      'actionCorrective': _action.text.trim(),
      'creerMaintenance': _creerMaint,
      'photos': _photos,
      'agentPresent': _agentPresent,
    });
  }

  /// Choix obligatoire Présent/Absent (sans valeur par défaut).
  Widget _agentSelector() {
    Widget bouton(bool value, String label, IconData icon, Color color) {
      final selected = _agentPresent == value;
      return Expanded(
        child: OutlinedButton.icon(
          onPressed: () => setState(() => _agentPresent = value),
          icon: Icon(icon, size: 16, color: selected ? Colors.white : color),
          label: Text(label),
          style: OutlinedButton.styleFrom(
            backgroundColor: selected ? color : null,
            foregroundColor: selected ? Colors.white : color,
            side: BorderSide(color: color.withValues(alpha: selected ? 1 : 0.5)),
          ),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 8),
        const Text('AGENT DE SÉCURITÉ (GARDIENNAGE)',
            style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, letterSpacing: 1.2, color: Colors.grey)),
        const SizedBox(height: 6),
        Row(children: [
          bouton(true, 'Présent', Icons.verified_user, const Color(0xFF0E7C6B)),
          const SizedBox(width: 8),
          bouton(false, 'Absent', Icons.person_off, const Color(0xFFC0392B)),
        ]),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final total = widget.dejaPresentes + _photos.length;
    final ok = total >= kMinPhotosIncident;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Clôturer l\'incident', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
              const SizedBox(height: 12),
              TextField(controller: _cause, decoration: const InputDecoration(labelText: 'Cause probable')),
              const SizedBox(height: 10),
              TextField(controller: _action, decoration: const InputDecoration(labelText: 'Action corrective')),
              const SizedBox(height: 6),
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                value: _creerMaint,
                onChanged: (v) => setState(() => _creerMaint = v ?? false),
                title: const Text('Créer une maintenance curative', style: TextStyle(fontSize: 13)),
              ),
              _agentSelector(),
              const SizedBox(height: 6),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: ok ? Colors.green.shade50 : Colors.orange.shade50,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                        'Photos $total/$kMinPhotosIncident (panne constatée, réparation, état final)'
                        '${widget.dejaPresentes > 0 ? ' — dont ${widget.dejaPresentes} déjà envoyée(s)' : ''}',
                        style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            color: ok ? Colors.green.shade800 : Colors.orange.shade900)),
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
                                // cacheWidth : décode une miniature → pas de gel mémoire.
                                child: Image.file(File(_photos[i].path),
                                    width: 60, height: 60, fit: BoxFit.cover, cacheWidth: 160),
                              ),
                              Positioned(
                                top: -6,
                                right: -6,
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
              if (_error != null) ...[
                const SizedBox(height: 8),
                Text(_error!, style: const TextStyle(color: Colors.red, fontSize: 12)),
              ],
              const SizedBox(height: 14),
              FilledButton.icon(
                onPressed: _submit,
                icon: const Icon(Icons.check_circle),
                label: const Text('Clôturer l\'incident'),
              ),
              const SizedBox(height: 8),
            ],
          ),
        ),
      ),
    );
  }
}
