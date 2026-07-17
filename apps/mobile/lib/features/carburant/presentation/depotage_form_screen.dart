import 'dart:io';
import 'dart:typed_data';
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import '../../../core/services/location_service.dart';
import '../../../core/sync/attachment_store.dart';
import '../../../core/widgets/signature_pad.dart';
import '../../../core/widgets/site_picker.dart';
import '../data/depotage_model.dart';
import '../data/depotage_repository.dart';
import '../data/depotage_draft.dart';

/// Seuil d'écart de livraison (%) au-delà duquel une photo de preuve est exigée.
/// Aligné sur le réglage serveur `carburant.seuilEcartLivraisonPct` (défaut 5).
const double _seuilEcartLivraisonPct = 5;

class DepotageFormScreen extends StatefulWidget {
  final String? initialSiteId;
  final String? initialLigneId;
  const DepotageFormScreen({super.key, this.initialSiteId, this.initialLigneId});

  @override
  State<DepotageFormScreen> createState() => _DepotageFormScreenState();
}

class _DepotageFormScreenState extends State<DepotageFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _stockAvant = TextEditingController();
  final _stockApres = TextEditingController();
  final _volumeAnnonce = TextEditingController();
  final _fournisseur = TextEditingController();
  final _bon = TextEditingController();
  final _obs = TextEditingController();
  final _nomChauffeur = TextEditingController();
  final _nomAgent = TextEditingController();
  final _picker = ImagePicker();

  String? _siteId;
  bool _saving = false;

  // Signatures de validation (chemins LOCAUX, uploadés par la sync).
  String? _sigChauffeur;
  String? _sigAgent;
  String? _sigTechnicien;

  // Photos des travaux de dépotage (chemins LOCAUX, uploadés par la sync).
  final List<String> _photos = [];
  // Déclaration obligatoire : agent de gardiennage présent au dépotage ?
  bool? _agentPresent;
  static const int _kMinPhotos = 6;

  // Plan de livraison prévu pour le site (chaîne BC → BL → plan).
  List<PlanLigne> _lignes = [];
  String? _ligneLivraisonId;
  bool _loadingLignes = false;

  // GE actifs du site → relevé d'index d'heures par GE (réconciliation conso).
  List<GroupeGE> _groupes = [];
  final Map<String, TextEditingController> _geIndex = {};

  // Index GE d'un brouillon en attente de restauration (les contrôleurs GE ne
  // sont créés qu'après le chargement asynchrone des groupes du site).
  Map<String, String> _pendingGeIndex = {};

  @override
  void initState() {
    super.initState();
    _siteId = widget.initialSiteId;
    // Recalcule le volume dérivé (après − avant) + sauvegarde le brouillon.
    _stockAvant.addListener(_onFieldChanged);
    _stockApres.addListener(_onFieldChanged);
    for (final c in [_volumeAnnonce, _fournisseur, _bon, _obs, _nomChauffeur, _nomAgent]) {
      c.addListener(_scheduleDraftSave);
    }
    // Propose de reprendre un brouillon (app tuée pendant la saisie).
    WidgetsBinding.instance.addPostFrameCallback((_) => _proposerBrouillon());
  }

  void _onFieldChanged() { setState(() {}); _scheduleDraftSave(); }

  Timer? _draftTimer;
  void _scheduleDraftSave() {
    _draftTimer?.cancel();
    _draftTimer = Timer(const Duration(milliseconds: 600), _saveDraft);
  }

  Future<void> _saveDraft() async {
    if (!mounted || _saving) return;
    // Rien de significatif saisi → pas de brouillon (évite un faux « reprendre »).
    final vide = _siteId == null && _photos.isEmpty && _stockAvant.text.isEmpty && _sigChauffeur == null;
    if (vide) return;
    await DepotageDraft.save({
      'siteId': _siteId, 'ligneLivraisonId': _ligneLivraisonId, 'agentPresent': _agentPresent,
      'stockAvant': _stockAvant.text, 'stockApres': _stockApres.text, 'volumeAnnonce': _volumeAnnonce.text,
      'fournisseur': _fournisseur.text, 'bon': _bon.text, 'obs': _obs.text,
      'nomChauffeur': _nomChauffeur.text, 'nomAgent': _nomAgent.text,
      'sigChauffeur': _sigChauffeur, 'sigAgent': _sigAgent, 'sigTechnicien': _sigTechnicien,
      'photos': _photos, 'geIndex': _geIndex.map((k, v) => MapEntry(k, v.text)),
    });
  }

  Future<void> _proposerBrouillon() async {
    final draft = await DepotageDraft.load();
    if (draft == null || !mounted) {
      if (_siteId != null) _loadSiteData(_siteId!);
      return;
    }
    final reprendre = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Reprendre le dépotage en cours ?'),
        content: const Text('Une saisie de dépotage non terminée a été retrouvée (jauges, photos, signatures). La reprendre ?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Repartir de zéro')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Reprendre')),
        ],
      ),
    );
    if (!mounted) return;
    if (reprendre == true) {
      _restaurerBrouillon(draft);
    } else {
      await DepotageDraft.clear();
      if (_siteId != null) _loadSiteData(_siteId!);
    }
  }

  void _restaurerBrouillon(Map<String, dynamic> d) {
    setState(() {
      _siteId = d['siteId'] as String? ?? _siteId;
      _ligneLivraisonId = d['ligneLivraisonId'] as String?;
      _agentPresent = d['agentPresent'] as bool?;
      _stockAvant.text = d['stockAvant'] as String? ?? '';
      _stockApres.text = d['stockApres'] as String? ?? '';
      _volumeAnnonce.text = d['volumeAnnonce'] as String? ?? '';
      _fournisseur.text = d['fournisseur'] as String? ?? '';
      _bon.text = d['bon'] as String? ?? '';
      _obs.text = d['obs'] as String? ?? '';
      _nomChauffeur.text = d['nomChauffeur'] as String? ?? '';
      _nomAgent.text = d['nomAgent'] as String? ?? '';
      _sigChauffeur = d['sigChauffeur'] as String?;
      _sigAgent = d['sigAgent'] as String?;
      _sigTechnicien = d['sigTechnicien'] as String?;
      _photos
        ..clear()
        ..addAll(((d['photos'] as List?) ?? const []).map((e) => e as String));
      _pendingGeIndex = ((d['geIndex'] as Map?) ?? const {}).map((k, v) => MapEntry(k as String, v as String));
    });
    if (_siteId != null) _loadSiteData(_siteId!); // recharge plan/GE, puis applique _pendingGeIndex
  }

  Future<void> _onSiteChanged(String? siteId) async {
    setState(() {
      _siteId = siteId;
      _ligneLivraisonId = null;
      _lignes = [];
      _groupes = [];
      for (final c in _geIndex.values) {
        c.dispose();
      }
      _geIndex.clear();
    });
    _scheduleDraftSave();
    if (siteId != null) _loadSiteData(siteId);
  }

  Future<void> _loadSiteData(String siteId) async {
    final repo = context.read<DepotageRepository>();
    setState(() => _loadingLignes = true);
    try {
      final results = await Future.wait([repo.getLignesLivraison(siteId), repo.getGroupes(siteId)]);
      if (!mounted) return;
      setState(() {
        _lignes = results[0] as List<PlanLigne>;
        _groupes = results[1] as List<GroupeGE>;
        for (final g in _groupes) {
          final c = _geIndex.putIfAbsent(g.id, () => TextEditingController());
          final saved = _pendingGeIndex[g.id];
          if (saved != null && saved.isNotEmpty) c.text = saved;
        }
        _pendingGeIndex = {};
        // Pré-rattachement à la ligne planifiée choisie (bouton intelligent).
        final wanted = widget.initialLigneId;
        if (wanted != null && _ligneLivraisonId == null && _lignes.any((x) => x.id == wanted)) {
          _ligneLivraisonId = wanted;
          final l = _lignes.firstWhere((x) => x.id == wanted);
          if (_volumeAnnonce.text.isEmpty) {
            final v = l.restant > 0 ? l.restant : l.volumePrevuLitres;
            _volumeAnnonce.text = v.toStringAsFixed(0);
          }
          if (_bon.text.isEmpty && l.numeroBL != null) _bon.text = l.numeroBL!;
        }
      });
    } catch (_) {
      // Plan et GE sont optionnels : on n'interrompt pas la saisie en cas d'échec.
    } finally {
      if (mounted) setState(() => _loadingLignes = false);
    }
  }

  void _selectLigne(String? ligneId) {
    final l = ligneId == null ? null : _lignes.firstWhere((x) => x.id == ligneId);
    setState(() {
      _ligneLivraisonId = ligneId;
      if (l != null) {
        // Volume annoncé = ce que le plan/BL prévoit de livrer ici.
        if (_volumeAnnonce.text.isEmpty) {
          final v = l.restant > 0 ? l.restant : l.volumePrevuLitres;
          _volumeAnnonce.text = v.toStringAsFixed(0);
        }
        if (_bon.text.isEmpty && l.numeroBL != null) _bon.text = l.numeroBL!;
      }
    });
  }

  @override
  void dispose() {
    _draftTimer?.cancel();
    _stockAvant.removeListener(_onFieldChanged);
    _stockApres.removeListener(_onFieldChanged);
    for (final c in [_stockAvant, _stockApres, _volumeAnnonce, _fournisseur, _bon, _obs, _nomChauffeur, _nomAgent]) {
      c.dispose();
    }
    for (final c in _geIndex.values) {
      c.dispose();
    }
    super.dispose();
  }

  double? _num(TextEditingController c) => c.text.isEmpty ? null : double.tryParse(c.text.replaceAll(',', '.'));

  /// Volume livré dérivé de la jauge (stock après − stock avant), ≥ 0.
  double? get _derivedVolume {
    final a = _num(_stockAvant);
    final b = _num(_stockApres);
    if (a == null || b == null) return null;
    return (b - a).clamp(0, double.infinity).toDouble();
  }

  Future<void> _capturePhoto() async {
    final img = await _picker.pickImage(source: ImageSource.camera, imageQuality: 70, maxWidth: 2000);
    if (img == null) return;
    final bytes = await img.readAsBytes();
    final ts = DateTime.now().microsecondsSinceEpoch;
    final path = await AttachmentStore.persistBytes(bytes, 'depotage-$ts.jpg');
    if (!mounted) return;
    setState(() => _photos.add(path));
    _scheduleDraftSave();
  }

  /// Ouvre le pavé de signature, persiste le PNG localement et renvoie son chemin.
  Future<void> _captureSignature(String slot) async {
    final navigator = Navigator.of(context);
    final bytes = await navigator.push<Object?>(
      MaterialPageRoute(builder: (_) => const SignaturePadScreen()),
    );
    if (bytes is! Uint8List) return;
    final ts = DateTime.now().microsecondsSinceEpoch;
    final path = await AttachmentStore.persistBytes(bytes, 'sig-$slot-$ts.png');
    if (!mounted) return;
    setState(() {
      if (slot == 'chauffeur') {
        _sigChauffeur = path;
      } else if (slot == 'agent') {
        _sigAgent = path;
      } else {
        _sigTechnicien = path;
      }
    });
  }

  Widget _agentBouton(bool value, String label, IconData icon, Color color) {
    final selected = _agentPresent == value;
    return Expanded(
      child: OutlinedButton.icon(
        onPressed: () {
          setState(() {
            _agentPresent = value;
            // Passer à « Absent » efface la signature/le nom d'agent éventuels
            // (sinon agentPresent=false + signature d'agent = contradiction).
            if (value == false) { _sigAgent = null; _nomAgent.clear(); }
          });
          _scheduleDraftSave();
        },
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

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false) || _siteId == null) return;
    final messenger = ScaffoldMessenger.of(context);
    // Validation tripartite obligatoire (chauffeur + technicien ; agent optionnel).
    if (_sigChauffeur == null) {
      messenger.showSnackBar(const SnackBar(content: Text('Signature du chauffeur requise'), backgroundColor: Colors.red));
      return;
    }
    if (_sigTechnicien == null) {
      messenger.showSnackBar(const SnackBar(content: Text('Votre signature (technicien) est requise'), backgroundColor: Colors.red));
      return;
    }
    // Déclaration gardiennage obligatoire + signature de l'agent s'il est présent.
    if (_agentPresent == null) {
      messenger.showSnackBar(const SnackBar(content: Text('Indiquez si l\'agent de sécurité est présent sur le site'), backgroundColor: Colors.red));
      return;
    }
    if (_agentPresent == true && _sigAgent == null) {
      messenger.showSnackBar(const SnackBar(content: Text('L\'agent est présent : sa signature est requise'), backgroundColor: Colors.red));
      return;
    }
    // Preuve terrain : minimum de photos prises sur place.
    if (_photos.length < _kMinPhotos) {
      messenger.showSnackBar(SnackBar(
        content: Text('Au moins $_kMinPhotos photos sont requises (${_photos.length} prise(s))'),
        backgroundColor: Colors.red,
      ));
      return;
    }
    // Preuve obligatoire : écart de livraison anormal (jauge vs annoncé) → ≥ 1 photo.
    final annonce = _num(_volumeAnnonce);
    final vol = _derivedVolume;
    if (annonce != null && annonce > 0 && vol != null && _photos.isEmpty) {
      final ecartPct = ((vol - annonce).abs() / annonce) * 100;
      if (ecartPct > _seuilEcartLivraisonPct) {
        messenger.showSnackBar(SnackBar(
          content: Text('Écart de livraison ${ecartPct.round()}% : ajoutez au moins une photo de preuve.'),
          backgroundColor: Colors.red,
        ));
        return;
      }
    }
    final repo = context.read<DepotageRepository>();
    final router = GoRouter.of(context);
    setState(() => _saving = true);
    try {
      final pos = await LocationService().currentPosition();
      // Index d'heures saisis par GE → [{groupeId, indexHeuresGE}].
      final heuresGE = <Map<String, dynamic>>[
        for (final g in _groupes)
          if (_num(_geIndex[g.id]!) != null) {'groupeId': g.id, 'indexHeuresGE': _num(_geIndex[g.id]!)},
      ];
      final res = await repo.create(
        siteId: _siteId!,
        volumeLitres: _derivedVolume ?? 0,
        agentPresent: _agentPresent!,
        stockAvantLitres: _num(_stockAvant),
        stockApresLitres: _num(_stockApres),
        volumeAnnonceLitres: _num(_volumeAnnonce),
        fournisseur: _fournisseur.text.trim(),
        numeroBonLivraison: _bon.text.trim(),
        observations: _obs.text.trim(),
        latitude: pos?.lat,
        longitude: pos?.lng,
        ligneLivraisonId: _ligneLivraisonId,
        heuresGE: heuresGE,
        photoPaths: _photos,
        nomChauffeur: _nomChauffeur.text.trim(),
        signatureChauffeurLocalPath: _sigChauffeur,
        nomAgentSecurite: _nomAgent.text.trim(),
        signatureAgentSecuriteLocalPath: _sigAgent,
        signatureTechnicienLocalPath: _sigTechnicien,
      );
      await DepotageDraft.clear(); // saisie envoyée (ou en file) → brouillon obsolète
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
            // ── Jauge cuve : le volume livré est DÉRIVÉ (après − avant) ──
            TextFormField(
              controller: _stockAvant,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'Stock avant dépotage (jauge, litres) *', prefixIcon: Icon(Icons.opacity)),
              validator: (v) => _num(_stockAvant) == null ? 'Jauge avant requise' : null,
            ),
            const SizedBox(height: 14),
            TextFormField(
              controller: _stockApres,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'Stock après dépotage (jauge, litres) *', prefixIcon: Icon(Icons.water_drop)),
              validator: (v) {
                final a = _num(_stockAvant), b = _num(_stockApres);
                if (b == null) return 'Jauge après requise';
                if (a != null && b < a) return 'La jauge après doit être ≥ jauge avant';
                return null;
              },
            ),
            const SizedBox(height: 10),
            _DerivedVolumeBanner(volume: _derivedVolume),
            const SizedBox(height: 14),
            TextFormField(
              controller: _volumeAnnonce,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'Volume annoncé (BL/bordereau, litres)', prefixIcon: Icon(Icons.receipt_long)),
            ),
            const SizedBox(height: 14),
            TextFormField(controller: _fournisseur, decoration: const InputDecoration(labelText: 'Fournisseur')),
            const SizedBox(height: 14),
            TextFormField(controller: _bon, decoration: const InputDecoration(labelText: 'N° bon de livraison')),
            const SizedBox(height: 14),
            TextFormField(controller: _obs, maxLines: 2, decoration: const InputDecoration(labelText: 'Observations')),
            const SizedBox(height: 20),

            // ── Relevé d'heures par GE (réconciliation conso) ──
            if (_groupes.isNotEmpty) ...[
              const Divider(),
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 6),
                child: Text('Relevé heures groupes électrogènes', style: TextStyle(fontWeight: FontWeight.w600)),
              ),
              ..._groupes.map((g) => Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: TextFormField(
                      controller: _geIndex[g.id],
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      decoration: InputDecoration(
                        labelText: 'GE n°${g.numero} — index heures',
                        helperText: '${g.puissanceKva.toStringAsFixed(0)} kVA · ${g.statut == 'GE_PERMANENT' ? 'permanent' : 'secours'}',
                        prefixIcon: const Icon(Icons.timer_outlined),
                        suffixText: 'h',
                      ),
                    ),
                  )),
              const SizedBox(height: 6),
            ],

            // ── Photos des travaux de dépotage ──
            const Divider(),
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Text(
                'Photos du dépotage (${_photos.length}/$_kMinPhotos minimum) *',
                style: TextStyle(
                  fontWeight: FontWeight.w600,
                  color: _photos.length >= _kMinPhotos ? const Color(0xFF0E7C6B) : null,
                ),
              ),
            ),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                ..._photos.asMap().entries.map((e) => Stack(
                      children: [
                        ClipRRect(
                          borderRadius: BorderRadius.circular(8),
                          child: Image.file(File(e.value), width: 84, height: 84, fit: BoxFit.cover),
                        ),
                        Positioned(
                          top: -6,
                          right: -6,
                          child: IconButton(
                            icon: const CircleAvatar(radius: 12, backgroundColor: Colors.black54, child: Icon(Icons.close, size: 14, color: Colors.white)),
                            onPressed: () => setState(() => _photos.removeAt(e.key)),
                          ),
                        ),
                      ],
                    )),
                InkWell(
                  onTap: _capturePhoto,
                  child: Container(
                    width: 84,
                    height: 84,
                    decoration: BoxDecoration(
                      border: Border.all(color: Colors.grey.shade400),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: const Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [Icon(Icons.add_a_photo, color: Colors.grey), SizedBox(height: 4), Text('Ajouter', style: TextStyle(fontSize: 11, color: Colors.grey))],
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),

            // ── Validation tripartite (signatures sur site) ──
            const Divider(),
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 6),
              child: Text('Validation sur site', style: TextStyle(fontWeight: FontWeight.w600)),
            ),
            TextFormField(controller: _nomChauffeur, decoration: const InputDecoration(labelText: 'Nom du chauffeur')),
            const SizedBox(height: 8),
            _SignatureTile(label: 'Signature du chauffeur *', captured: _sigChauffeur != null, onTap: () => _captureSignature('chauffeur')),
            const SizedBox(height: 14),
            const Text('AGENT DE SÉCURITÉ (GARDIENNAGE)',
                style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, letterSpacing: 1.2, color: Colors.grey)),
            const SizedBox(height: 6),
            Row(children: [
              _agentBouton(true, 'Présent', Icons.verified_user, const Color(0xFF0E7C6B)),
              const SizedBox(width: 8),
              _agentBouton(false, 'Absent', Icons.person_off, const Color(0xFFC0392B)),
            ]),
            if (_agentPresent == true) ...[
              const SizedBox(height: 10),
              TextFormField(controller: _nomAgent, decoration: const InputDecoration(labelText: 'Nom de l\'agent de sécurité')),
              const SizedBox(height: 8),
              _SignatureTile(label: 'Signature agent de sécurité *', captured: _sigAgent != null, onTap: () => _captureSignature('agent')),
            ],
            const SizedBox(height: 14),
            _SignatureTile(label: 'Votre signature (technicien) *', captured: _sigTechnicien != null, onTap: () => _captureSignature('technicien')),

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

/// Bandeau du volume livré DÉRIVÉ de la jauge (stock après − stock avant).
class _DerivedVolumeBanner extends StatelessWidget {
  final double? volume;
  const _DerivedVolumeBanner({required this.volume});

  @override
  Widget build(BuildContext context) {
    final ok = volume != null && volume! > 0;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: ok ? Colors.green.withValues(alpha: 0.08) : Colors.grey.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: ok ? Colors.green.shade300 : Colors.grey.shade300),
      ),
      child: Row(
        children: [
          Icon(Icons.calculate_outlined, size: 20, color: ok ? Colors.green.shade700 : Colors.grey),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              volume == null
                  ? 'Volume livré : renseignez les deux jauges'
                  : 'Volume livré déduit : ${volume!.toStringAsFixed(0)} L',
              style: TextStyle(fontWeight: FontWeight.w600, color: ok ? Colors.green.shade800 : Colors.grey.shade700),
            ),
          ),
        ],
      ),
    );
  }
}

/// Ligne de capture de signature : affiche l'état (à signer / signé) et déclenche le pavé.
class _SignatureTile extends StatelessWidget {
  final String label;
  final bool captured;
  final VoidCallback onTap;
  const _SignatureTile({required this.label, required this.captured, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return OutlinedButton.icon(
      onPressed: onTap,
      icon: Icon(captured ? Icons.check_circle : Icons.draw, color: captured ? Colors.green : null),
      label: Align(
        alignment: Alignment.centerLeft,
        child: Text(captured ? '$label — signé' : label),
      ),
      style: OutlinedButton.styleFrom(
        padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 12),
        side: BorderSide(color: captured ? Colors.green : Colors.grey.shade400),
        minimumSize: const Size.fromHeight(48),
      ),
    );
  }
}
