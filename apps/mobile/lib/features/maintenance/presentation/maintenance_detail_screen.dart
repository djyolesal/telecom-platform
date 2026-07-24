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
  // Photos AVANT travaux (état des lieux), prises pendant l'intervention.
  final _pickerAvant = ImagePicker();
  final List<XFile> _photosAvant = [];

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
          'Vous êtes à ${dist.round()} m${fix.accuracyM > 0 ? ' (± ${fix.accuracyM.round()} m)' : ''} du site ${m.siteNom ?? ''}.\nRapprochez-vous à moins de ${AppConfig.geofenceRadiusM.round()} m pour $action.');
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

  /// Suspension : motif obligatoire (urgence sur un autre site). Le verrou
  /// « une seule maintenance en cours » est libéré côté serveur.
  /// Sections de photos groupées par phase : Avant travaux / Après travaux /
  /// non phasées (photos historiques d'avant cette fonctionnalité).
  List<Widget> _photoSections(Maintenance m) {
    final avant = <String>[], apres = <String>[], autres = <String>[];
    for (var i = 0; i < m.photoUrls.length; i++) {
      final phase = i < m.photoPhases.length ? m.photoPhases[i] : null;
      (phase == 'AVANT' ? avant : phase == 'APRES' ? apres : autres).add(m.photoUrls[i]);
    }
    Widget titre(String txt) => Text(txt,
        style: TextStyle(fontWeight: FontWeight.w600, color: Colors.grey.shade700, fontSize: 13));
    if (avant.isEmpty && apres.isEmpty) {
      return [titre('Photos (${autres.length})'), const SizedBox(height: 10), PhotoThumbnails(urls: autres)];
    }
    return [
      if (avant.isNotEmpty) ...[
        titre('Avant travaux (${avant.length})'),
        const SizedBox(height: 10),
        PhotoThumbnails(urls: avant),
      ],
      if (apres.isNotEmpty) ...[
        if (avant.isNotEmpty) const SizedBox(height: 12),
        titre('Après travaux (${apres.length})'),
        const SizedBox(height: 10),
        PhotoThumbnails(urls: apres),
      ],
      if (autres.isNotEmpty) ...[
        const SizedBox(height: 12),
        titre('Autres photos (${autres.length})'),
        const SizedBox(height: 10),
        PhotoThumbnails(urls: autres),
      ],
    ];
  }

  /// Photo d'état des lieux AVANT travaux (caméra uniquement, comme la clôture).
  Future<void> _prendrePhotoAvant() async {
    try {
      final img = await _pickerAvant.pickImage(
        source: ImageSource.camera, maxWidth: 1600, maxHeight: 1600, imageQuality: 70,
      );
      if (img != null) setState(() => _photosAvant.add(img));
    } catch (_) {/* annulé / permission refusée */}
  }

  Future<void> _envoyerPhotosAvant() async {
    if (_photosAvant.isEmpty) return;
    final repo = context.read<MaintenanceRepository>();
    setState(() => _busy = true);
    try {
      // Copie persistante : les fichiers temporaires d'image_picker peuvent être
      // purgés par l'OS avant la resynchronisation.
      final paths = <String>[];
      for (final x in _photosAvant) {
        paths.add(await AttachmentStore.persistFile(x.path));
      }
      final res = await repo.addPhotos(widget.id, photoPaths: paths, phase: 'AVANT');
      if (!mounted) return;
      _snack(res.isQueued
          ? '${paths.length} photo(s) en file — elles partiront à la reconnexion'
          : '${paths.length} photo(s) envoyée(s)');
      setState(() => _photosAvant.clear());
      _reload();
    } catch (e) {
      if (mounted) _snack(_errMsg(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _suspend(Maintenance m) async {
    final repo = context.read<MaintenanceRepository>();
    // Le contrôleur du champ appartient au DIALOGUE (State dédié) : le framework
    // le détruit après le démontage complet. Un dispose() juste après showDialog
    // tuait le contrôleur pendant l'animation de fermeture (« Annuler ») →
    // assertion `_dependents.isEmpty` (écran rouge).
    final motif = await showDialog<String>(
      context: context,
      builder: (_) => const _MotifSuspensionDialog(),
    );
    if (motif == null || !mounted) return;
    setState(() => _busy = true);
    try {
      final res = await repo.suspend(widget.id, motif: motif);
      if (!mounted) return;
      _snack(res.isQueued ? 'Suspension mise en file — elle partira à la reconnexion' : 'Maintenance suspendue');
      _reload();
    } catch (e) {
      if (mounted) _snack(_errMsg(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Reprise : présence sur site exigée (même vérification GPS qu'un démarrage).
  Future<void> _resume(Maintenance m) async {
    final repo = context.read<MaintenanceRepository>();
    setState(() => _busy = true);
    try {
      final check = await _verifyOnSite(m, 'la reprise');
      if (!check.ok) return;
      final res = await repo.resume(widget.id, latitude: check.lat, longitude: check.lng);
      if (!mounted) return;
      _snack(res.isQueued ? 'Reprise mise en file — elle partira à la reconnexion' : 'Maintenance reprise');
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
    final ecoule = DateTime.now().difference(debut).inMinutes - m.dureeSuspendueMinutes;
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
        agentPresent: result['agentPresent'] as bool,
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
              if (m.reference != null)
                Text(m.reference!, style: const TextStyle(fontSize: 12, color: Colors.grey, fontWeight: FontWeight.w600, letterSpacing: 0.5)),
              Text('${m.siteNom ?? ''} · ${m.equipement}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
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
                      children: _photoSections(m),
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 16),
              if (m.statut == 'PLANIFIEE')
                FilledButton.icon(onPressed: _busy ? null : () => _start(m), icon: const Icon(Icons.play_arrow), label: const Text('Démarrer')),
              if (m.statut == 'EN_COURS') ...[
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Photos avant travaux (état des lieux)',
                            style: TextStyle(fontWeight: FontWeight.w600, color: Colors.grey.shade700, fontSize: 13)),
                        const SizedBox(height: 4),
                        Text('Prenez l’état initial dès le démarrage — les photos de fin se prennent à la clôture.',
                            style: TextStyle(fontSize: 12, color: Colors.grey.shade600)),
                        const SizedBox(height: 8),
                        if (_photosAvant.isNotEmpty)
                          Wrap(
                            spacing: 6, runSpacing: 6,
                            children: List.generate(_photosAvant.length, (i) => Stack(children: [
                              ClipRRect(
                                borderRadius: BorderRadius.circular(6),
                                child: Image.file(File(_photosAvant[i].path), width: 56, height: 56, fit: BoxFit.cover, cacheWidth: 150),
                              ),
                              Positioned(
                                top: -8, right: -8,
                                child: IconButton(
                                  icon: const Icon(Icons.cancel, size: 18, color: Colors.red),
                                  onPressed: () => setState(() => _photosAvant.removeAt(i)),
                                ),
                              ),
                            ])),
                          ),
                        Row(children: [
                          Expanded(
                            child: OutlinedButton.icon(
                              onPressed: _busy ? null : _prendrePhotoAvant,
                              icon: const Icon(Icons.camera_alt, size: 18),
                              label: const Text('Photo'),
                            ),
                          ),
                          if (_photosAvant.isNotEmpty) ...[
                            const SizedBox(width: 8),
                            Expanded(
                              child: FilledButton.icon(
                                onPressed: _busy ? null : _envoyerPhotosAvant,
                                icon: const Icon(Icons.cloud_upload, size: 18),
                                label: Text('Envoyer (${_photosAvant.length})'),
                              ),
                            ),
                          ],
                        ]),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                FilledButton.icon(onPressed: _busy ? null : () => _close(m), icon: const Icon(Icons.check_circle), label: const Text('Clôturer')),
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  onPressed: _busy ? null : () => _suspend(m),
                  icon: const Icon(Icons.pause_circle_outline),
                  label: const Text('Suspendre (urgence ailleurs)'),
                ),
              ],
              if (m.statut == 'SUSPENDUE') ...[
                Card(
                  color: const Color(0xFFFDF3DF),
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Row(children: [
                      const Icon(Icons.pause_circle, color: Color(0xFFE67E22), size: 18),
                      const SizedBox(width: 8),
                      Expanded(child: Text('Suspendue${m.motifSuspension != null ? ' — ${m.motifSuspension}' : ''}', style: const TextStyle(fontSize: 13))),
                    ]),
                  ),
                ),
                const SizedBox(height: 8),
                FilledButton.icon(
                  onPressed: _busy ? null : () => _resume(m),
                  icon: const Icon(Icons.play_circle_outline),
                  label: const Text('Reprendre (sur site)'),
                ),
              ],
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
  // Vidange par GE : choix explicite du technicien (sinon pré-cochage au seuil).
  final Map<String, bool> _vidange = {};
  final Set<String> _vidangeTouched = {};
  // Déclaration obligatoire : agent de gardiennage présent sur site ?
  bool? _agentPresent;
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

  /// Heures de marche depuis la dernière vidange, d'après l'index saisi (null si inconnu).
  double? _heuresDepuisVidange(GroupeGE g) {
    final idx = _num(_geCtrls[g.id]!);
    final ref = g.indexDerniereVidange;
    return (idx == null || ref == null) ? null : idx - ref;
  }

  /// État effectif de la case vidange : choix du technicien, sinon pré-cochée au seuil.
  bool _vidangeEffective(GroupeGE g) {
    if (_vidangeTouched.contains(g.id)) return _vidange[g.id] ?? false;
    final h = _heuresDepuisVidange(g);
    return h != null && h >= AppConfig.intervalleVidangeHeures;
  }

  /// Case « Vidange effectuée » sous l'index horaire du GE, avec le compteur
  /// d'heures depuis la dernière vidange (seuil configurable, 250 h par défaut).
  Widget _vidangeTile(GroupeGE g) {
    final seuil = AppConfig.intervalleVidangeHeures;
    final h = _heuresDepuisVidange(g);
    final due = h != null && h >= seuil;
    final String hint;
    if (g.indexDerniereVidange == null) {
      hint = 'Première vidange non encore enregistrée — cochez si effectuée.';
    } else if (h == null) {
      hint = 'Saisissez l\'index pour évaluer (seuil $seuil h).';
    } else if (h < 0) {
      hint = 'Index inférieur à la dernière vidange (compteur remplacé ?).';
    } else {
      hint = '${h.toStringAsFixed(0)} h depuis la dernière vidange (seuil $seuil h).';
    }
    return CheckboxListTile(
      contentPadding: EdgeInsets.zero,
      dense: true,
      controlAffinity: ListTileControlAffinity.leading,
      value: _vidangeEffective(g),
      onChanged: (v) => setState(() {
        _vidangeTouched.add(g.id);
        _vidange[g.id] = v ?? false;
      }),
      title: Text('Vidange GE n°${g.numero} effectuée', style: const TextStyle(fontSize: 13)),
      subtitle: Text(hint,
          style: TextStyle(fontSize: 11, color: due ? Colors.orange.shade800 : Colors.grey.shade600)),
    );
  }

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
        // Vidange confirmée sur certains GE → le serveur fige l'index de référence.
        final vidangeIds = groupes.where(_vidangeEffective).map((g) => g.id).toList();
        if (vidangeIds.isNotEmpty) energie['vidangeGeIds'] = vidangeIds;
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

    if (_agentPresent == null) {
      setState(() => _error = 'Indiquez si l\'agent de sécurité est présent sur le site.');
      return;
    }

    Navigator.pop(context, {
      'observations': _obs.text.trim(),
      'energie': energie,
      'photos': _photos,
      'agentPresent': _agentPresent,
    });
  }

  /// Choix obligatoire Présent/Absent (sans valeur par défaut : une case
  /// pré-cochée serait validée machinalement et la donnée ne vaudrait rien).
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
        const SizedBox(height: 12),
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
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  TextField(
                                    controller: _geCtrls[g.id],
                                    keyboardType: numKb,
                                    // Recalcule en direct « X h depuis la dernière vidange ».
                                    onChanged: (_) => setState(() {}),
                                    decoration: InputDecoration(labelText: 'Index horaire GE n°${g.numero} (carte GE) *'),
                                  ),
                                  _vidangeTile(g),
                                ],
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
            _agentSelector(),
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

/// Dialogue de motif de suspension : possède SON contrôleur de texte (détruit
/// par le framework après démontage — jamais pendant l'animation de fermeture).
class _MotifSuspensionDialog extends StatefulWidget {
  const _MotifSuspensionDialog();
  @override
  State<_MotifSuspensionDialog> createState() => _MotifSuspensionDialogState();
}

class _MotifSuspensionDialogState extends State<_MotifSuspensionDialog> {
  final _ctrl = TextEditingController();

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Suspendre la maintenance'),
      content: TextField(
        controller: _ctrl,
        autofocus: true,
        maxLength: 200,
        decoration: const InputDecoration(
          labelText: 'Motif (obligatoire)',
          hintText: 'ex. Urgence INC-2026-00112 sur un autre site',
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Annuler')),
        // Le motif doit faire ≥ 5 caractères ; sinon retour visuel explicite.
        FilledButton(
          onPressed: () {
            final v = _ctrl.text.trim();
            if (v.length >= 5) {
              Navigator.pop(context, v);
            } else {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Motif trop court (5 caractères minimum)')),
              );
            }
          },
          child: const Text('Suspendre'),
        ),
      ],
    );
  }
}
