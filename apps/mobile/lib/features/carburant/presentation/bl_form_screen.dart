import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import '../../../core/errors/exceptions.dart';
import '../../../core/sync/attachment_store.dart';
import '../data/depotage_model.dart';
import '../data/bon_livraison_repository.dart';
import '../../../core/theme/app_theme.dart';

const _moisLabels = [
  '',
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre'
];

class BlFormScreen extends StatefulWidget {
  const BlFormScreen({super.key});

  @override
  State<BlFormScreen> createState() => _BlFormScreenState();
}

class _BlFormScreenState extends State<BlFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _numeroBL = TextEditingController();
  final _immat = TextEditingController();
  final _chauffeur = TextEditingController();
  final _volume = TextEditingController();
  final _obs = TextEditingController();
  final _picker = ImagePicker();

  late Future<List<BonCommandeLite>> _bcsFuture;
  BonCommandeLite? _bc;
  int? _mois;
  // Pas de valeur par défaut : la date de chargement ne figure pas sur le BL
  // (la date du document est celle du traitement) — saisie manuelle obligatoire.
  DateTime? _dateChargement;
  DateTime? _dateTraitement;
  String? _blDoc;
  String? _bordereauDoc;
  bool _saving = false;
  bool _analysing = false;
  List<String> _avertissements = const [];

  @override
  void initState() {
    super.initState();
    _bcsFuture = context.read<BonLivraisonRepository>().getBonsCommande();
  }

  @override
  void dispose() {
    for (final c in [_numeroBL, _immat, _chauffeur, _volume, _obs]) {
      c.dispose();
    }
    super.dispose();
  }

  double? _num(TextEditingController c) =>
      c.text.isEmpty ? null : double.tryParse(c.text.replaceAll(',', '.'));

  String _fmtDate(DateTime d) =>
      '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year}';

  Future<void> _pickDate() async {
    // Le camion charge avant la saisie : on n'autorise pas de date future.
    final picked = await showDatePicker(
      context: context,
      initialDate: _dateChargement ?? DateTime.now(),
      firstDate: DateTime(2020),
      lastDate: DateTime.now(),
    );
    if (picked != null && mounted) setState(() => _dateChargement = picked);
  }

  /// Scan du bordereau de chargement (la photo du BL vient du bouton scan du BL).
  /// Qualité « document » comme le scan du BL : un justificatif doit rester lisible.
  Future<void> _scannerBordereau() async {
    final img = await _picker.pickImage(
        source: ImageSource.camera, imageQuality: 85, maxWidth: 2400);
    if (img == null) return;
    final bytes = await img.readAsBytes();
    final ts = DateTime.now().microsecondsSinceEpoch;
    final path =
        await AttachmentStore.persistBytes(bytes, 'doc-bordereau-$ts.jpg');
    if (!mounted) return;
    setState(() => _bordereauDoc = path);
  }

  /// Photographie le BL, l'envoie à l'analyse serveur (OCR) et PRÉ-REMPLIT le
  /// formulaire — le transporteur relit et corrige avant d'enregistrer. La photo
  /// sert aussi de pièce jointe « Photo du bon de livraison ».
  Future<void> _scannerBl() async {
    final messenger = ScaffoldMessenger.of(context);
    // Qualité soignée : l'OCR a besoin de netteté (85 %, 2400 px max).
    final img = await _picker.pickImage(
        source: ImageSource.camera, imageQuality: 85, maxWidth: 2400);
    if (img == null) return;
    final bytes = await img.readAsBytes();
    final ts = DateTime.now().microsecondsSinceEpoch;
    final path = await AttachmentStore.persistBytes(bytes, 'doc-bl-$ts.jpg');
    if (!mounted) return;
    setState(() {
      _blDoc = path;
      _analysing = true;
      _avertissements = const [];
    });
    try {
      final repo = context.read<BonLivraisonRepository>();
      final res = await repo.analyserPhoto(bytes);
      if (!mounted) return;
      if (res == null) {
        messenger.showSnackBar(const SnackBar(
            content: Text(
                'Hors ligne : analyse indisponible — photo conservée, saisie manuelle.')));
        return;
      }
      final d = res.documents.isNotEmpty ? res.documents.first : null;
      if (d == null) {
        messenger.showSnackBar(const SnackBar(
            content: Text('Aucun BL reconnu sur la photo — saisie manuelle.'),
            backgroundColor: Colors.orange));
        return;
      }
      final bcsDispo = await _bcsFuture;
      setState(() {
        if (d.numeroBL != null) _numeroBL.text = d.numeroBL!;
        if (d.immatriculation != null) _immat.text = d.immatriculation!;
        if (d.volumeChargeLitres != null) {
          _volume.text = d.volumeChargeLitres!.toString();
        }
        // Date de traitement = celle qui SUIT le n° de bon de commande sur le
        // document — la date de chargement, elle, reste à saisir à la main.
        _dateTraitement = d.traitement;
        // Présélection du BC référencé sur le document (« BC N°POxxxxxxxxx »).
        final bcNumero = d.bcNumero;
        final avert = List<String>.from(d.avertissements);
        if (bcNumero != null) {
          final trouve = bcsDispo.where((b) => b.numero == bcNumero).toList();
          if (trouve.isNotEmpty) {
            _bc = trouve.first;
            if (_mois == null && _bc!.mois.isNotEmpty) _mois = _bc!.mois.first;
          } else {
            avert.insert(0,
                'Le bon de commande $bcNumero du document est introuvable — sélectionnez-le manuellement.');
          }
        }
        _avertissements = avert;
      });
      messenger.showSnackBar(const SnackBar(
          content: Text(
              'BL lu — vérifiez les valeurs et saisissez la date de chargement.')));
    } on ServerException catch (e) {
      if (mounted) {
        messenger.showSnackBar(
            SnackBar(content: Text(e.message), backgroundColor: Colors.orange));
      }
    } catch (_) {
      if (mounted) {
        messenger.showSnackBar(const SnackBar(
            content:
                Text('Analyse impossible — photo conservée, saisie manuelle.'),
            backgroundColor: Colors.orange));
      }
    } finally {
      if (mounted) setState(() => _analysing = false);
    }
  }

  Future<void> _submit() async {
    final messenger = ScaffoldMessenger.of(context);
    if (!(_formKey.currentState?.validate() ?? false) ||
        _bc == null ||
        _mois == null) {
      messenger.showSnackBar(const SnackBar(
          content: Text('Renseignez le bon de commande et le mois'),
          backgroundColor: Colors.red));
      return;
    }
    if (_dateChargement == null) {
      messenger.showSnackBar(const SnackBar(
          content: Text('Saisissez la date de chargement du camion'),
          backgroundColor: Colors.red));
      return;
    }
    // Les DEUX pièces sont OBLIGATOIRES, et on bloque ICI, avant la mise en
    // file. Sans ce contrôle, une saisie hors-ligne partait en attente pour
    // n'être refusée qu'au rejeu, loin du dépôt — les documents n'étant alors
    // plus photographiables.
    if (_blDoc == null) {
      messenger.showSnackBar(const SnackBar(
        content: Text('Scannez le bon de livraison avant d\'enregistrer'),
        backgroundColor: Colors.red,
      ));
      return;
    }
    if (_bordereauDoc == null) {
      messenger.showSnackBar(const SnackBar(
        content:
            Text('Scannez le bordereau de chargement avant d\'enregistrer'),
        backgroundColor: Colors.red,
      ));
      return;
    }
    final repo = context.read<BonLivraisonRepository>();
    final router = GoRouter.of(context);
    setState(() => _saving = true);
    try {
      final res = await repo.create(
        bonCommandeId: _bc!.id,
        numeroBL: _numeroBL.text.trim(),
        mois: _mois!,
        annee: _bc!.annee,
        immatriculation: _immat.text.trim(),
        nomChauffeur: _chauffeur.text.trim(),
        volumeChargeLitres: _num(_volume) ?? 0,
        dateChargement: _dateChargement!,
        dateTraitement: _dateTraitement,
        observations: _obs.text.trim(),
        blDocLocalPath: _blDoc,
        bordereauDocLocalPath: _bordereauDoc,
      );
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(
        content: Text(res.isQueued
            ? 'Hors-ligne : bon de livraison mis en file de synchronisation'
            : 'Bon de livraison enregistré'),
      ));
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
      appBar: AppBar(title: const Text('Nouveau bon de livraison')),
      body: FutureBuilder<List<BonCommandeLite>>(
        future: _bcsFuture,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          final bcs = snap.data ?? [];
          if (bcs.isEmpty) {
            return const Center(
                child: Padding(
                    padding: EdgeInsets.all(24),
                    child: Text(
                        'Aucun bon de commande disponible (connexion requise).')));
          }
          final moisDispo = _bc?.mois ?? const [];
          return Form(
            key: _formKey,
            child: ListView(
              padding: paddingEcran(context),
              children: [
                OutlinedButton.icon(
                  onPressed: _analysing ? null : _scannerBl,
                  icon: _analysing
                      ? const SizedBox(
                          height: 18,
                          width: 18,
                          child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.document_scanner),
                  label: Text(_analysing
                      ? 'Analyse du BL en cours…'
                      : _blDoc != null
                          ? 'BL scanné — appuyez pour reprendre'
                          : 'Scanner le BL (obligatoire, pré-remplit)'),
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    minimumSize: const Size.fromHeight(48),
                  ),
                ),
                if (_avertissements.isNotEmpty)
                  Container(
                    margin: const EdgeInsets.only(top: 10),
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: Colors.orange.shade50,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: Colors.orange.shade200),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: _avertissements
                          .map((a) => Text('⚠ $a',
                              style: TextStyle(
                                  fontSize: 12.5,
                                  color: Colors.orange.shade900)))
                          .toList(),
                    ),
                  ),
                const SizedBox(height: 14),
                DropdownButtonFormField<String>(
                  initialValue: _bc?.id,
                  isExpanded: true,
                  decoration: const InputDecoration(
                      labelText: 'Bon de commande *',
                      prefixIcon: Icon(Icons.receipt_long)),
                  items: bcs
                      .map((b) => DropdownMenuItem(
                          value: b.id,
                          child: Text(
                              '${b.numero} · T${b.trimestre} ${b.annee}',
                              overflow: TextOverflow.ellipsis)))
                      .toList(),
                  onChanged: (v) => setState(() {
                    _bc = bcs.firstWhere((b) => b.id == v);
                    _mois = _bc!.mois.isNotEmpty ? _bc!.mois.first : null;
                  }),
                  validator: (v) => v == null ? 'Requis' : null,
                ),
                const SizedBox(height: 14),
                if (moisDispo.isNotEmpty) ...[
                  DropdownButtonFormField<int>(
                    initialValue: _mois,
                    decoration: const InputDecoration(
                        labelText: 'Mois exécuté *',
                        prefixIcon: Icon(Icons.calendar_month)),
                    items: moisDispo
                        .map((m) => DropdownMenuItem(
                            value: m, child: Text(_moisLabels[m])))
                        .toList(),
                    onChanged: (v) => setState(() => _mois = v),
                  ),
                  const SizedBox(height: 14),
                ],
                InputDecorator(
                  decoration: const InputDecoration(
                      labelText: 'Date de chargement du camion *',
                      prefixIcon: Icon(Icons.event)),
                  child: InkWell(
                    onTap: _pickDate,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            _dateChargement != null
                                ? _fmtDate(_dateChargement!)
                                : 'Choisir la date…',
                            style: _dateChargement == null
                                ? TextStyle(color: Theme.of(context).hintColor)
                                : null,
                          ),
                          const Icon(Icons.calendar_today, size: 18),
                        ],
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 14),
                TextFormField(
                  controller: _numeroBL,
                  decoration: const InputDecoration(
                      labelText: 'N° bon de livraison *',
                      prefixIcon: Icon(Icons.confirmation_number)),
                  validator: (v) =>
                      (v == null || v.trim().isEmpty) ? 'Requis' : null,
                ),
                const SizedBox(height: 14),
                TextFormField(
                  controller: _immat,
                  decoration: const InputDecoration(
                      labelText: 'Immatriculation camion *',
                      prefixIcon: Icon(Icons.local_shipping)),
                  validator: (v) =>
                      (v == null || v.trim().isEmpty) ? 'Requis' : null,
                ),
                const SizedBox(height: 14),
                TextFormField(
                  controller: _chauffeur,
                  textCapitalization: TextCapitalization.words,
                  decoration: const InputDecoration(
                    labelText: 'Chauffeur (déclaré au départ) *',
                    prefixIcon: Icon(Icons.badge_outlined),
                    // Déclaré ici, il sera confronté au nom signé sur site : un
                    // camion confié à quelqu'un d'autre en route devient visible.
                    helperText:
                        'Nom du chauffeur qui prend le camion au dépôt.',
                    helperMaxLines: 2,
                  ),
                  validator: (v) =>
                      (v == null || v.trim().length < 2) ? 'Requis' : null,
                ),
                const SizedBox(height: 14),
                TextFormField(
                  controller: _volume,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(
                      labelText: 'Volume chargé (litres) *',
                      prefixIcon: Icon(Icons.water_drop)),
                  validator: (v) =>
                      (_num(_volume) == null || _num(_volume)! <= 0)
                          ? 'Volume requis'
                          : null,
                ),
                const SizedBox(height: 14),
                TextFormField(
                    controller: _obs,
                    maxLines: 2,
                    decoration:
                        const InputDecoration(labelText: 'Observations')),
                const SizedBox(height: 20),
                const Divider(),
                const Padding(
                    padding: EdgeInsets.symmetric(vertical: 6),
                    child: Text('Documents (photos)',
                        style: TextStyle(fontWeight: FontWeight.w600))),
                // La photo du BL provient du bouton « Scanner le BL » en haut (qui
                // sert à la fois au pré-remplissage et à la pièce jointe) : plus de
                // tuile séparée qui reprenait la même photo.
                Row(
                  children: [
                    Icon(
                        _blDoc != null
                            ? Icons.check_circle
                            : Icons.photo_camera_outlined,
                        size: 18,
                        color: _blDoc != null ? Colors.green : Colors.grey),
                    const SizedBox(width: 8),
                    Expanded(
                        child: Text(
                      _blDoc != null
                          ? 'Photo du bon de livraison jointe (via le scan)'
                          : 'Photo du bon de livraison * — utilisez « Scanner le BL » en haut',
                      style: TextStyle(
                          fontSize: 12.5,
                          color: _blDoc != null
                              ? Colors.green.shade800
                              : Colors.grey.shade600),
                    )),
                  ],
                ),
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  onPressed: _scannerBordereau,
                  icon: Icon(
                      _bordereauDoc != null
                          ? Icons.check_circle
                          : Icons.document_scanner,
                      color: _bordereauDoc != null ? Colors.green : null),
                  label: Align(
                    alignment: Alignment.centerLeft,
                    child: Text(_bordereauDoc != null
                        ? 'Bordereau de chargement scanné — appuyez pour reprendre'
                        : 'Scanner le bordereau de chargement *'),
                  ),
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(
                        vertical: 14, horizontal: 12),
                    side: BorderSide(
                        color: _bordereauDoc != null
                            ? Colors.green
                            : Colors.grey.shade400),
                    minimumSize: const Size.fromHeight(48),
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
                      : const Icon(Icons.save),
                  label: const Text('Enregistrer'),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}
