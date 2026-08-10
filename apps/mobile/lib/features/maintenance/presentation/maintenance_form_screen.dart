import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import '../../../core/constants/enums.dart';
import '../../../core/services/location_service.dart';
import '../../../core/utils/formatters.dart';
import '../../../core/widgets/site_picker.dart';
import '../../sites/data/site_model.dart';
import '../../sites/data/site_repository.dart';
import '../data/maintenance_model.dart';
import '../data/maintenance_repository.dart';
import '../../../core/theme/app_theme.dart';

const _natureOptions = [
  ('ENTRETIEN', 'Entretien (tâche contractuelle)'),
  ('CURATIVE', 'Dépannage / curative (GE en panne)'),
  ('INSTALLATION', 'Installation d\'un actif'),
  ('DESINSTALLATION', 'Désinstallation d\'un actif'),
  ('DEPLACEMENT', 'Déplacement d\'un actif'),
];

class MaintenanceFormScreen extends StatefulWidget {
  final String? initialSiteId;
  const MaintenanceFormScreen({super.key, this.initialSiteId});

  @override
  State<MaintenanceFormScreen> createState() => _MaintenanceFormScreenState();
}

class _MaintenanceFormScreenState extends State<MaintenanceFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _description = TextEditingController();

  String _nature = 'ENTRETIEN';
  String? _siteId; // entretien : site ; installation/déplacement : destination
  String? _tacheKey;
  List<TacheSite> _taches = [];
  bool _loadingTaches = false;

  List<ActifLite> _actifs = [];
  ActifLite? _actif;
  bool _loadingActifs = false;

  // Dépannage curatif : GE du site sélectionné (imputation de la panne à un GE).
  List<ActifLite> _gesDuSite = [];
  ActifLite? _geEnPanne;
  bool _loadingGes = false;

  DateTime _datePlanifiee = DateTime.now();
  bool _saving = false;

  bool get _isEntretien => _nature == 'ENTRETIEN';
  bool get _isCurative => _nature == 'CURATIVE';
  bool get _isMouvement =>
      _nature == 'INSTALLATION' ||
      _nature == 'DESINSTALLATION' ||
      _nature == 'DEPLACEMENT';
  bool get _needsDest => _nature == 'INSTALLATION' || _nature == 'DEPLACEMENT';

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
    setState(() {
      _loadingTaches = true;
      _taches = [];
      _tacheKey = null;
    });
    final repo = context.read<SiteRepository>();
    final taches = await repo.getTachesPreventives(siteId);
    if (!mounted) return;
    setState(() {
      _taches = taches;
      _loadingTaches = false;
    });
  }

  Future<void> _loadActifs() async {
    setState(() {
      _loadingActifs = true;
      _actifs = [];
      _actif = null;
    });
    final repo = context.read<MaintenanceRepository>();
    final actifs = _nature == 'INSTALLATION'
        ? await repo.getActifs(enStock: true)
        : await repo.getActifs(statut: 'EN_SERVICE');
    if (!mounted) return;
    setState(() {
      _actifs = actifs;
      _loadingActifs = false;
    });
  }

  Future<void> _loadGesDuSite(String siteId) async {
    setState(() {
      _loadingGes = true;
      _gesDuSite = [];
      _geEnPanne = null;
    });
    final repo = context.read<MaintenanceRepository>();
    final ges = await repo.getActifs(type: 'GE', siteId: siteId);
    if (!mounted) return;
    setState(() {
      _gesDuSite = ges;
      _loadingGes = false;
    });
  }

  void _onNatureChanged(String? v) {
    if (v == null) return;
    setState(() {
      _nature = v;
      _tacheKey = null;
      _actif = null;
      _siteId = null;
      _taches = [];
      _actifs = [];
      _gesDuSite = [];
      _geEnPanne = null;
    });
    if (_isMouvement) _loadActifs();
  }

  void _onSiteChanged(String? v) {
    _siteId = v;
    if (_isEntretien) {
      if (v != null) {
        _loadTaches(v);
      } else {
        setState(() {
          _taches = [];
          _tacheKey = null;
        });
      }
    } else if (_isCurative) {
      if (v != null) {
        _loadGesDuSite(v);
      } else {
        setState(() {
          _gesDuSite = [];
          _geEnPanne = null;
        });
      }
    } else {
      setState(() {});
    }
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final init = _datePlanifiee.isBefore(today) ? today : _datePlanifiee;
    final d = await showDatePicker(
        context: context,
        initialDate: init,
        firstDate: today,
        lastDate: now.add(const Duration(days: 365)));
    if (d != null) setState(() => _datePlanifiee = d);
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    final messenger = ScaffoldMessenger.of(context);
    final repo = context.read<MaintenanceRepository>();
    final router = GoRouter.of(context);

    // Construit la requête selon la nature.
    String? payloadSiteId,
        type,
        categorie,
        equipement,
        tacheKey,
        actifType,
        actifId,
        siteSourceId;
    if (_isEntretien) {
      if (_siteId == null) {
        messenger.showSnackBar(
            const SnackBar(content: Text('Sélectionnez un site')));
        return;
      }
      TacheSite? tache;
      for (final t in _taches) {
        if (t.key == _tacheKey) {
          tache = t;
          break;
        }
      }
      if (tache == null) {
        messenger.showSnackBar(const SnackBar(
            content: Text('Sélectionnez une tâche contractuelle')));
        return;
      }
      payloadSiteId = _siteId;
      type = 'PREVENTIVE';
      categorie = tache.categorie;
      equipement = tache.libelle;
      tacheKey = tache.key;
    } else if (_isCurative) {
      if (_siteId == null) {
        messenger.showSnackBar(
            const SnackBar(content: Text('Sélectionnez un site')));
        return;
      }
      final ge = _geEnPanne;
      if (ge == null) {
        messenger.showSnackBar(
            const SnackBar(content: Text('Sélectionnez le GE en panne')));
        return;
      }
      payloadSiteId = _siteId;
      type = 'CURATIVE';
      categorie = 'GE';
      equipement = 'Dépannage — ${ge.libelle ?? 'GE'}';
      actifType = 'GE';
      actifId = ge.id; // rattachement pour la fiabilité par marque
    } else {
      final actif = _actif;
      if (actif == null) {
        messenger.showSnackBar(
            const SnackBar(content: Text('Sélectionnez un actif')));
        return;
      }
      if (_needsDest && _siteId == null) {
        messenger.showSnackBar(const SnackBar(
            content: Text('Sélectionnez le site de destination')));
        return;
      }
      payloadSiteId = _nature == 'DESINSTALLATION' ? actif.siteId : _siteId;
      if (payloadSiteId == null) {
        messenger.showSnackBar(
            const SnackBar(content: Text('Site indéterminé pour cet actif')));
        return;
      }
      type = 'CURATIVE';
      categorie = actif.categorie;
      equipement =
          '${kNatureTravaux[_nature]} — ${actif.libelle ?? actif.categorie}';
      actifType = actif.actifType;
      actifId = actif.id;
      siteSourceId = _nature == 'DEPLACEMENT' ? actif.siteId : null;
    }

    setState(() => _saving = true);
    try {
      final pos = await LocationService().currentPosition();
      final now = DateTime.now();
      final datePlanifiee = _datePlanifiee.isBefore(now) ? now : _datePlanifiee;
      // Une curative n'est pas un mouvement d'actif → natureTravaux ENTRETIEN
      // (l'enum côté serveur ne connaît que ENTRETIEN/INSTALLATION/DÉSINSTALLATION/DÉPLACEMENT).
      final natureTravaux = _isMouvement ? _nature : 'ENTRETIEN';
      final res = await repo.create(
        siteId: payloadSiteId!,
        type: type,
        categorie: categorie,
        equipement: equipement,
        tachePreventiveKey: tacheKey,
        natureTravaux: natureTravaux,
        actifType: actifType,
        actifId: actifId,
        siteSourceId: siteSourceId,
        description: _description.text.trim(),
        datePlanifiee: datePlanifiee,
        latitude: pos?.lat,
        longitude: pos?.lng,
      );
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(
          content: Text(res.isQueued
              ? 'Hors-ligne : enregistré et mis en file de synchronisation'
              : 'Intervention planifiée')));
      router.pop();
    } catch (e) {
      if (mounted) {
        messenger.showSnackBar(SnackBar(
            content: Text('Erreur : $e'), backgroundColor: Colors.red));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Planifier une intervention')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: paddingEcran(context),
          children: [
            DropdownButtonFormField<String>(
              initialValue: _nature,
              isExpanded: true,
              decoration:
                  const InputDecoration(labelText: 'Nature des travaux *'),
              items: _natureOptions
                  .map((o) => DropdownMenuItem(
                      value: o.$1,
                      child: Text(o.$2, overflow: TextOverflow.ellipsis)))
                  .toList(),
              onChanged: _onNatureChanged,
            ),
            const SizedBox(height: 14),
            if (_isEntretien) ...[
              SitePicker(initialSiteId: _siteId, onChanged: _onSiteChanged),
              const SizedBox(height: 14),
              DropdownButtonFormField<String>(
                initialValue: _tacheKey,
                isExpanded: true,
                decoration: InputDecoration(
                  labelText: 'Tâche contractuelle *',
                  hintText:
                      _siteId == null ? 'Choisissez d\'abord un site' : null,
                  suffixIcon: _loadingTaches
                      ? const Padding(
                          padding: EdgeInsets.all(12),
                          child: SizedBox(
                              height: 16,
                              width: 16,
                              child: CircularProgressIndicator(strokeWidth: 2)))
                      : null,
                ),
                items: _taches
                    .map((t) => DropdownMenuItem(
                        value: t.key,
                        child:
                            Text(t.libelle, overflow: TextOverflow.ellipsis)))
                    .toList(),
                onChanged: _siteId == null
                    ? null
                    : (v) => setState(() => _tacheKey = v),
                validator: (v) =>
                    _isEntretien && (v == null || v.isEmpty) ? 'Requis' : null,
              ),
            ] else if (_isCurative) ...[
              SitePicker(initialSiteId: _siteId, onChanged: _onSiteChanged),
              const SizedBox(height: 14),
              DropdownButtonFormField<String>(
                initialValue: _geEnPanne?.id,
                isExpanded: true,
                decoration: InputDecoration(
                  labelText: 'GE en panne *',
                  hintText: _siteId == null
                      ? 'Choisissez d\'abord un site'
                      : (_gesDuSite.isEmpty && !_loadingGes
                          ? 'Aucun GE sur ce site'
                          : null),
                  suffixIcon: _loadingGes
                      ? const Padding(
                          padding: EdgeInsets.all(12),
                          child: SizedBox(
                              height: 16,
                              width: 16,
                              child: CircularProgressIndicator(strokeWidth: 2)))
                      : null,
                ),
                items: _gesDuSite
                    .map((g) => DropdownMenuItem(
                        value: g.id,
                        child: Text(g.libelle ?? 'GE',
                            overflow: TextOverflow.ellipsis)))
                    .toList(),
                onChanged: _siteId == null
                    ? null
                    : (v) => setState(() => _geEnPanne =
                        _gesDuSite.where((g) => g.id == v).firstOrNull),
                validator: (v) =>
                    _isCurative && (v == null || v.isEmpty) ? 'Requis' : null,
              ),
            ] else ...[
              DropdownButtonFormField<String>(
                initialValue: _actif?.id,
                isExpanded: true,
                decoration: InputDecoration(
                  labelText: _nature == 'INSTALLATION'
                      ? 'Actif au dépôt *'
                      : 'Actif en service *',
                  suffixIcon: _loadingActifs
                      ? const Padding(
                          padding: EdgeInsets.all(12),
                          child: SizedBox(
                              height: 16,
                              width: 16,
                              child: CircularProgressIndicator(strokeWidth: 2)))
                      : null,
                ),
                items: _actifs
                    .map((a) => DropdownMenuItem(
                        value: a.id,
                        child:
                            Text(a.display, overflow: TextOverflow.ellipsis)))
                    .toList(),
                onChanged: (v) => setState(
                    () => _actif = _actifs.where((a) => a.id == v).firstOrNull),
                validator: (v) =>
                    !_isEntretien && (v == null || v.isEmpty) ? 'Requis' : null,
              ),
              if (_needsDest) ...[
                const SizedBox(height: 14),
                SitePicker(initialSiteId: _siteId, onChanged: _onSiteChanged),
              ],
            ],
            const SizedBox(height: 14),
            ListTile(
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                  side: BorderSide(color: Colors.grey.shade300)),
              leading: const Icon(Icons.calendar_today, size: 20),
              title: const Text('Date planifiée'),
              subtitle: Text(fmtDate(_datePlanifiee)),
              onTap: _pickDate,
            ),
            const SizedBox(height: 14),
            TextFormField(
                controller: _description,
                maxLines: 3,
                decoration: const InputDecoration(
                    labelText: 'Description', alignLabelWithHint: true)),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: _saving ? null : _submit,
              icon: _saving
                  ? const SizedBox(
                      height: 18,
                      width: 18,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white))
                  : const Icon(Icons.save),
              label: const Text('Enregistrer'),
            ),
          ],
        ),
      ),
    );
  }
}
