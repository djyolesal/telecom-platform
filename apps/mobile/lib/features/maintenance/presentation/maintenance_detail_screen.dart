import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:image_picker/image_picker.dart';
import '../../../core/config/app_config.dart';
import '../../../core/constants/enums.dart';
import '../../../core/errors/exceptions.dart';
import '../../../core/services/location_service.dart';
import '../../../core/sync/attachment_store.dart';
import '../../../core/utils/formatters.dart';
import '../../../core/widgets/common_widgets.dart';
import '../../../core/widgets/gps_refine_sheet.dart';
import '../../../core/widgets/photo_gallery.dart';
import '../../../core/widgets/signature_pad.dart';
import '../data/maintenance_model.dart';
import '../data/maintenance_repository.dart';


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
    // Aligne les seuils (durée min, rayon géofence) sur la config serveur.
    context.read<ConfigService>().load();
  }

  void _reload() => setState(() {
        // Bloc (pas de flèche) : une flèche renverrait le Future de l'assignation,
        // ce que setState rejette ("callback argument returned a Future").
        _future = context.read<MaintenanceRepository>().getMaintenance(widget.id);
      });

  /// Vérifie la présence physique sur le site avant une opération, après un
  /// AFFINAGE GPS (~5 m visés, feuille avec précision en direct). Retourne
  /// (ok, lat, lng). Si le site n'a pas de coordonnées, la vérification est
  /// ignorée (le serveur tranchera). Affiche un dialogue si hors site.
  Future<({bool ok, double? lat, double? lng})> _verifyOnSite(Maintenance m, String action) async {
    final hasSiteCoords = m.siteLatitude != null && m.siteLongitude != null;
    if (!hasSiteCoords) {
      // Site non géolocalisé : simple capture silencieuse pour tracer la position.
      final pos = await LocationService().freshPosition();
      return (ok: true, lat: pos?.lat, lng: pos?.lng);
    }
    final fix = await refineGpsPosition(context);
    if (fix == null) {
      await _siteDialog('Position GPS indisponible',
          'Impossible de vérifier votre présence sur site pour $action. Activez la localisation (précision élevée) et réessayez.');
      return (ok: false, lat: null, lng: null);
    }
    final dist = LocationService.distanceMeters(fix.lat, fix.lng, m.siteLatitude!, m.siteLongitude!);
    if (dist > AppConfig.geofenceRadiusM) {
      await _siteDialog('Vous n\'êtes pas sur le site',
          'Vous êtes à ${dist.round()} m${fix.accuracyM > 0 ? ' (± ${fix.accuracyM.round()} m)' : ''} du site ${m.siteNom ?? m.siteCode ?? ''}.\nRapprochez-vous à moins de ${AppConfig.geofenceRadiusM.round()} m pour $action.');
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

  Future<void> _start(Maintenance m) async {
    final repo = context.read<MaintenanceRepository>();
    setState(() => _busy = true);
    try {
      final check = await _verifyOnSite(m, 'le démarrage');
      if (!check.ok) return;
      final res = await repo.start(widget.id, latitude: check.lat, longitude: check.lng);
      if (!mounted) return;
      _snack(res.isQueued ? 'Démarrage mis en file — il partira à la reconnexion' : 'Maintenance démarrée');
      _reload();
    } catch (e) {
      if (mounted) _snack(_errMsg(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _close(Maintenance m) async {
    final repo = context.read<MaintenanceRepository>();
    final navigator = Navigator.of(context);

    // 0. Durée minimale 1h depuis le démarrage.
    final debut = m.dateDebut;
    if (debut == null) {
      _snack('La maintenance doit d\'abord être démarrée.');
      return;
    }
    final ecoule = DateTime.now().difference(debut).inMinutes;
    if (ecoule < AppConfig.minDureeClotureMin) {
      _snack('Clôture possible après ${AppConfig.minDureeClotureMin} min de travail (encore ${AppConfig.minDureeClotureMin - ecoule} min).');
      return;
    }

    // 1. Vérifier la présence sur site AVANT de saisir la clôture
    //    (inutile de remplir relevés/photos si on n'est pas sur place).
    setState(() => _busy = true);
    final check = await _verifyOnSite(m, 'la clôture');
    if (mounted) setState(() => _busy = false);
    if (!check.ok || !mounted) return;

    // 2. Formulaire de clôture (observations + énergie si passive + photos si préventive).
    //    La feuille impose déjà ≥ AppConfig.minPhotosPreventive photos prises à la caméra.
    final result = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _CloseSheet(maintenance: m),
    );
    if (result == null) return;

    setState(() => _busy = true);
    try {
      // Photos (caméra) → copie dans un stockage persistant. L'upload vers MinIO
      // est DIFFÉRÉ au moteur de sync : immédiat si en ligne, sinon à la reconnexion.
      final photoFiles = (result['photos'] as List?)?.cast<XFile>() ?? <XFile>[];
      final photoPaths = <String>[];
      for (final f in photoFiles) {
        photoPaths.add(await AttachmentStore.persistFile(f.path));
      }

      // Signature → persistée localement (uploadée par la sync). Obligatoire pour
      // un travail de cycle de vie (preuve du mouvement d'actif), sinon optionnelle.
      String? signaturePath;
      final bytes = await navigator.push<dynamic>(
        MaterialPageRoute(builder: (_) => const SignaturePadScreen()),
      );
      if (bytes != null) {
        signaturePath = await AttachmentStore.persistBytes(bytes as Uint8List, 'signature-${widget.id}.png');
      }
      if (m.natureTravaux != 'ENTRETIEN' && signaturePath == null) {
        if (mounted) { _snack('Signature requise pour valider ce mouvement d\'actif'); setState(() => _busy = false); }
        return;
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
    } catch (e) {
      if (mounted) _snack(_errMsg(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _snack(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  /// Message clair selon le type d'erreur (au lieu d'une exception brute).
  String _errMsg(Object e) {
    if (e is ServerException) return e.message; // ex: « Vous n'êtes pas sur le site… », photos < 6
    if (e is UnauthorizedException) return 'Session expirée — reconnectez-vous puis réessayez.';
    if (e is NetworkException) return 'Connexion indisponible — réessayez une fois en ligne.';
    return 'Erreur : $e';
  }

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
              Text('${m.siteNom ?? m.siteCode ?? ''} · ${m.equipement}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              StatusChip(label: kStatutMaintenance[m.statut] ?? m.statut, color: Colors.blue),
              const SizedBox(height: 16),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(children: [
                    if (m.natureTravaux != 'ENTRETIEN') _row('Nature', kNatureTravaux[m.natureTravaux] ?? m.natureTravaux),
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
              if (m.analyseEnergie != null && m.analyseEnergie!.isNotEmpty) ...[
                const SizedBox(height: 8),
                _AnalyseCard(texte: m.analyseEnergie!),
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

/// Carte « Analyse de cohérence énergie » générée à la clôture.
/// Orange en cas d'anomalie (texte préfixé ⚠), vert sinon.
class _AnalyseCard extends StatelessWidget {
  final String texte;
  const _AnalyseCard({required this.texte});

  @override
  Widget build(BuildContext context) {
    final alerte = texte.startsWith('⚠');
    final bg = alerte ? const Color(0xFFFFF7ED) : const Color(0xFFF0FDF4); // orange50 / green50
    final border = alerte ? const Color(0xFFFED7AA) : const Color(0xFFBBF7D0);
    final titre = alerte ? const Color(0xFF9A3412) : const Color(0xFF166534);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Icon(alerte ? Icons.warning_amber_rounded : Icons.check_circle_outline, size: 16, color: titre),
            const SizedBox(width: 6),
            Text('Analyse de cohérence énergie', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13, color: titre)),
          ]),
          const SizedBox(height: 6),
          Text(texte.replaceFirst('⚠ ', ''), style: const TextStyle(fontSize: 13, color: Colors.black87)),
        ],
      ),
    );
  }
}

/// Sources d'énergie présentes selon la configuration du site (aligné sur l'API).
/// Verbe décrivant l'effet du mouvement sur l'actif à la clôture.
String _mouvementVerbe(String nature) {
  switch (nature) {
    case 'INSTALLATION':
      return 'posé sur ce site';
    case 'DESINSTALLATION':
      return 'déposé et renvoyé au dépôt';
    case 'DEPLACEMENT':
      return 'déplacé vers ce site';
    default:
      return 'mis à jour';
  }
}

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
  final _puissance = TextEditingController();
  final _picker = ImagePicker();
  final List<XFile> _photos = [];
  // Un contrôleur d'index horaire par GE du site (cuve partagée → un seul _gasoil).
  final Map<String, TextEditingController> _geCtrls = {};
  String? _error;

  @override
  void initState() {
    super.initState();
    for (final g in widget.maintenance.siteGroupes) {
      _geCtrls[g.id] = TextEditingController();
    }
  }

  @override
  void dispose() {
    for (final c in [_obs, _gasoil, _heures, _index, _puissance, ..._geCtrls.values]) {
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
      // maxWidth/maxHeight LIMITENT le redimensionnement natif : sans bornes,
      // image_picker décode+recompresse la photo pleine résolution (12 Mpx) sur
      // le thread principal → ANR (l'app se fige) au bout de quelques photos.
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
    final m = widget.maintenance;
    final sources = m.requiresEnergie ? sourcesForConfig(m.sitePowerConfig) : <String>[];
    final energie = <String, dynamic>{};

    // Photos obligatoires pour une maintenance préventive
    if (m.type == 'PREVENTIVE' && _photos.length < AppConfig.minPhotosPreventive) {
      setState(() => _error = 'Au moins ${AppConfig.minPhotosPreventive} photos sont requises (${_photos.length} prise(s)).');
      return;
    }
    // Preuve obligatoire pour un travail de cycle de vie (photos ; la signature
    // est imposée juste après, à l'écran de signature).
    if (m.natureTravaux != 'ENTRETIEN' && _photos.length < AppConfig.minPhotosMouvement) {
      setState(() => _error = 'Au moins ${AppConfig.minPhotosMouvement} photos sont requises pour ce mouvement d\'actif (${_photos.length} prise(s)).');
      return;
    }

    if (sources.contains('GE')) {
      if (_num(_gasoil) == null) {
        setState(() => _error = 'Renseignez le volume gasoil dans la cuve.');
        return;
      }
      energie['volumeGasoilLitres'] = _num(_gasoil); // niveau actuel de la cuve (partagée)
      final groupes = widget.maintenance.siteGroupes;
      if (groupes.isNotEmpty) {
        final geHours = <String, dynamic>{};
        for (final g in groupes) {
          final v = _num(_geCtrls[g.id]!);
          if (v == null) {
            setState(() => _error = 'Renseignez l\'index horaire du GE n°${g.numero}.');
            return;
          }
          geHours[g.id] = v;
        }
        energie['geHours'] = geHours; // index horaire par GE
      } else {
        if (_num(_heures) == null) {
          setState(() => _error = 'Renseignez l\'index horaire GE.');
          return;
        }
        energie['indexHeuresGE'] = _num(_heures);
      }
    }
    if (sources.contains('CEET')) {
      if (_num(_index) == null) {
        setState(() => _error = "Renseignez l'index compteur CEET.");
        return;
      }
      energie['indexCompteur'] = _num(_index); // index cumulé ; la conso kWh est calculée côté serveur
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
    final sources = m.requiresEnergie ? sourcesForConfig(m.sitePowerConfig) : <String>[];
    // Photos requises : 6 pour une préventive, 2 pour un travail de cycle de vie.
    final minPhotos = m.type == 'PREVENTIVE' ? AppConfig.minPhotosPreventive : (m.natureTravaux != 'ENTRETIEN' ? AppConfig.minPhotosMouvement : 0);
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
            if (m.natureTravaux != 'ENTRETIEN') ...[
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: Colors.green.shade50, borderRadius: BorderRadius.circular(10)),
                child: Row(children: [
                  Icon(Icons.swap_horiz, size: 18, color: Colors.green.shade700),
                  const SizedBox(width: 8),
                  Expanded(child: Text('À la clôture, l\'actif sera ${_mouvementVerbe(m.natureTravaux)}.',
                      style: TextStyle(fontSize: 12, color: Colors.green.shade800))),
                ]),
              ),
              const SizedBox(height: 12),
            ],
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
                      TextField(controller: _gasoil, keyboardType: numKb, decoration: const InputDecoration(labelText: 'Volume gasoil dans la cuve (L) *')),
                      const SizedBox(height: 10),
                      if (m.siteGroupes.isNotEmpty)
                        ...m.siteGroupes.map((g) => Padding(
                              padding: const EdgeInsets.only(bottom: 10),
                              child: TextField(
                                controller: _geCtrls[g.id],
                                keyboardType: numKb,
                                decoration: InputDecoration(labelText: 'Index horaire GE n°${g.numero} (carte GE) *'),
                              ),
                            ))
                      else ...[
                        TextField(controller: _heures, keyboardType: numKb, decoration: const InputDecoration(labelText: 'Index horaire GE (carte GE) *')),
                        const SizedBox(height: 10),
                      ],
                    ],
                    if (sources.contains('CEET')) ...[
                      TextField(controller: _index, keyboardType: numKb, decoration: const InputDecoration(labelText: 'Index compteur CEET *')),
                      const SizedBox(height: 10),
                    ],
                    if (sources.contains('SOLAIRE'))
                      TextField(controller: _puissance, keyboardType: numKb, decoration: const InputDecoration(labelText: 'Puissance solaire (kVA) *')),
                  ],
                ),
              ),
              const SizedBox(height: 12),
            ],
            if (minPhotos > 0) ...[
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: _photos.length >= minPhotos ? Colors.green.shade50 : Colors.orange.shade50,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Photos ${_photos.length}/$minPhotos (carte GE, compteur CEET, activités)',
                        style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            color: _photos.length >= minPhotos ? Colors.green.shade800 : Colors.orange.shade900)),
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
                                // cacheWidth : décode une miniature (pas l'image pleine
                                // résolution) → évite la surcharge mémoire / le gel.
                                child: Image.file(File(_photos[i].path), width: 60, height: 60, fit: BoxFit.cover, cacheWidth: 160),
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
