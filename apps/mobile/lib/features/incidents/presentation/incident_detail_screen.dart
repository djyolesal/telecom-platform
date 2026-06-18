import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../core/constants/enums.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/formatters.dart';
import '../../../core/widgets/common_widgets.dart';
import '../data/incident_model.dart';
import '../data/incident_repository.dart';

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

  Future<void> _closeFlow() async {
    final repo = context.read<IncidentRepository>();
    final now = DateTime.now();
    final cause = TextEditingController();
    final action = TextEditingController();
    var creerMaint = false;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSt) => AlertDialog(
          title: const Text('Clôturer l\'incident'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(controller: cause, decoration: const InputDecoration(labelText: 'Cause probable')),
                const SizedBox(height: 10),
                TextField(controller: action, decoration: const InputDecoration(labelText: 'Action corrective')),
                const SizedBox(height: 6),
                CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  value: creerMaint,
                  onChanged: (v) => setSt(() => creerMaint = v ?? false),
                  title: const Text('Créer une maintenance curative', style: TextStyle(fontSize: 13)),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Annuler')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Clôturer')),
          ],
        ),
      ),
    );

    if (confirmed != true) return;
    setState(() => _busy = true);
    final res = await repo.close(
          id: widget.id,
          dateIntervention: now,
          dateResolution: now,
          causeProbable: cause.text.trim(),
          actionCorrective: action.text.trim(),
          creerMaintenance: creerMaint,
        );
    if (!mounted) return;
    setState(() => _busy = false);
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(res.isQueued ? 'Clôture mise en file (hors-ligne)' : 'Incident clôturé'),
    ));
    _reload();
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
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text('${inc.siteCode ?? ''} · ${kTypeIncident[inc.type] ?? inc.type}',
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
              const SizedBox(height: 16),
              if (!resolu)
                FilledButton.icon(
                  onPressed: _busy ? null : _closeFlow,
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
