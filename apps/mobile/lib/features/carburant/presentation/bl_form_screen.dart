import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import '../../../core/sync/attachment_store.dart';
import '../data/depotage_model.dart';
import '../data/bon_livraison_repository.dart';

const _moisLabels = ['', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

class BlFormScreen extends StatefulWidget {
  const BlFormScreen({super.key});

  @override
  State<BlFormScreen> createState() => _BlFormScreenState();
}

class _BlFormScreenState extends State<BlFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _numeroBL = TextEditingController();
  final _immat = TextEditingController();
  final _volume = TextEditingController();
  final _obs = TextEditingController();
  final _picker = ImagePicker();

  late Future<List<BonCommandeLite>> _bcsFuture;
  BonCommandeLite? _bc;
  int? _mois;
  DateTime _dateChargement = DateTime.now();
  String? _blDoc;
  String? _bordereauDoc;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _bcsFuture = context.read<BonLivraisonRepository>().getBonsCommande();
  }

  @override
  void dispose() {
    for (final c in [_numeroBL, _immat, _volume, _obs]) {
      c.dispose();
    }
    super.dispose();
  }

  double? _num(TextEditingController c) => c.text.isEmpty ? null : double.tryParse(c.text.replaceAll(',', '.'));

  String _fmtDate(DateTime d) => '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year}';

  Future<void> _pickDate() async {
    // Le camion charge avant la saisie : on n'autorise pas de date future.
    final picked = await showDatePicker(
      context: context,
      initialDate: _dateChargement,
      firstDate: DateTime(2020),
      lastDate: DateTime.now(),
    );
    if (picked != null && mounted) setState(() => _dateChargement = picked);
  }

  Future<void> _capture(String slot) async {
    final img = await _picker.pickImage(source: ImageSource.camera, imageQuality: 70, maxWidth: 2000);
    if (img == null) return;
    final bytes = await img.readAsBytes();
    final ts = DateTime.now().microsecondsSinceEpoch;
    final path = await AttachmentStore.persistBytes(bytes, 'doc-$slot-$ts.jpg');
    if (!mounted) return;
    setState(() {
      if (slot == 'bl') {
        _blDoc = path;
      } else {
        _bordereauDoc = path;
      }
    });
  }

  Future<void> _submit() async {
    final messenger = ScaffoldMessenger.of(context);
    if (!(_formKey.currentState?.validate() ?? false) || _bc == null || _mois == null) {
      messenger.showSnackBar(const SnackBar(content: Text('Renseignez le bon de commande et le mois'), backgroundColor: Colors.red));
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
        volumeChargeLitres: _num(_volume) ?? 0,
        dateChargement: _dateChargement,
        observations: _obs.text.trim(),
        blDocLocalPath: _blDoc,
        bordereauDocLocalPath: _bordereauDoc,
      );
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(
        content: Text(res.isQueued ? 'Hors-ligne : bon de livraison mis en file de synchronisation' : 'Bon de livraison enregistré'),
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
      appBar: AppBar(title: const Text('Nouveau bon de livraison')),
      body: FutureBuilder<List<BonCommandeLite>>(
        future: _bcsFuture,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          final bcs = snap.data ?? [];
          if (bcs.isEmpty) {
            return const Center(child: Padding(padding: EdgeInsets.all(24), child: Text('Aucun bon de commande disponible (connexion requise).')));
          }
          final moisDispo = _bc?.mois ?? const [];
          return Form(
            key: _formKey,
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                DropdownButtonFormField<String>(
                  initialValue: _bc?.id,
                  isExpanded: true,
                  decoration: const InputDecoration(labelText: 'Bon de commande *', prefixIcon: Icon(Icons.receipt_long)),
                  items: bcs.map((b) => DropdownMenuItem(value: b.id, child: Text('${b.numero} · T${b.trimestre} ${b.annee}', overflow: TextOverflow.ellipsis))).toList(),
                  onChanged: (v) => setState(() { _bc = bcs.firstWhere((b) => b.id == v); _mois = _bc!.mois.isNotEmpty ? _bc!.mois.first : null; }),
                  validator: (v) => v == null ? 'Requis' : null,
                ),
                const SizedBox(height: 14),
                if (moisDispo.isNotEmpty) ...[
                  DropdownButtonFormField<int>(
                    initialValue: _mois,
                    decoration: const InputDecoration(labelText: 'Mois exécuté *', prefixIcon: Icon(Icons.calendar_month)),
                    items: moisDispo.map((m) => DropdownMenuItem(value: m, child: Text(_moisLabels[m]))).toList(),
                    onChanged: (v) => setState(() => _mois = v),
                  ),
                  const SizedBox(height: 14),
                ],
                InputDecorator(
                  decoration: const InputDecoration(labelText: 'Date de chargement du camion *', prefixIcon: Icon(Icons.event)),
                  child: InkWell(
                    onTap: _pickDate,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [Text(_fmtDate(_dateChargement)), const Icon(Icons.calendar_today, size: 18)],
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 14),
                TextFormField(
                  controller: _numeroBL,
                  decoration: const InputDecoration(labelText: 'N° bon de livraison *', prefixIcon: Icon(Icons.confirmation_number)),
                  validator: (v) => (v == null || v.trim().isEmpty) ? 'Requis' : null,
                ),
                const SizedBox(height: 14),
                TextFormField(
                  controller: _immat,
                  decoration: const InputDecoration(labelText: 'Immatriculation camion *', prefixIcon: Icon(Icons.local_shipping)),
                  validator: (v) => (v == null || v.trim().isEmpty) ? 'Requis' : null,
                ),
                const SizedBox(height: 14),
                TextFormField(
                  controller: _volume,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(labelText: 'Volume chargé (litres) *', prefixIcon: Icon(Icons.water_drop)),
                  validator: (v) => (_num(_volume) == null || _num(_volume)! <= 0) ? 'Volume requis' : null,
                ),
                const SizedBox(height: 14),
                TextFormField(controller: _obs, maxLines: 2, decoration: const InputDecoration(labelText: 'Observations')),
                const SizedBox(height: 20),
                const Divider(),
                const Padding(padding: EdgeInsets.symmetric(vertical: 6), child: Text('Documents (photos)', style: TextStyle(fontWeight: FontWeight.w600))),
                _DocTile(label: 'Photo du bon de livraison', captured: _blDoc != null, onTap: () => _capture('bl')),
                const SizedBox(height: 10),
                _DocTile(label: 'Photo du bordereau de chargement', captured: _bordereauDoc != null, onTap: () => _capture('bordereau')),
                const SizedBox(height: 24),
                FilledButton.icon(
                  onPressed: _saving ? null : _submit,
                  icon: _saving ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.save),
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

class _DocTile extends StatelessWidget {
  final String label;
  final bool captured;
  final VoidCallback onTap;
  const _DocTile({required this.label, required this.captured, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return OutlinedButton.icon(
      onPressed: onTap,
      icon: Icon(captured ? Icons.check_circle : Icons.photo_camera, color: captured ? Colors.green : null),
      label: Align(alignment: Alignment.centerLeft, child: Text(captured ? '$label — joint' : label)),
      style: OutlinedButton.styleFrom(
        padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 12),
        side: BorderSide(color: captured ? Colors.green : Colors.grey.shade400),
        minimumSize: const Size.fromHeight(48),
      ),
    );
  }
}
