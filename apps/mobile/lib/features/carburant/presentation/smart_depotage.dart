import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import '../../../core/config/app_config.dart';
import '../../../core/services/location_service.dart';
import '../../sites/data/site_model.dart';
import '../../sites/data/site_repository.dart';
import '../data/depotage_repository.dart';

/// Dépotage intelligent : AFFINE d'abord la position (flux GPS jusqu'à ~5 m
/// de précision, avec retour visuel), puis détecte si le technicien est SUR
/// un site et montre ses livraisons planifiées (chaque ligne lance un dépotage
/// pré-rattaché) ; sinon le notifie et ouvre le formulaire vierge.
/// Utilisé par la liste des dépotages (FAB) et par le tableau de bord.
Future<void> smartDepoter(BuildContext context) async {
  final messenger = ScaffoldMessenger.of(context);
  final router = GoRouter.of(context);
  final siteRepo = context.read<SiteRepository>();

  // Affinage GPS : feuille avec précision en direct (annulable).
  final fix = await showModalBottomSheet<GpsFix>(
    context: context,
    isDismissible: false,
    enableDrag: false,
    builder: (_) => const _GpsRefineSheet(),
  );
  if (fix == null || !context.mounted) return; // annulé ou GPS indisponible

  final sites = await siteRepo.getSites();
  Site? onSite;
  double best = double.infinity;
  for (final s in sites) {
    if (s.latitude == null || s.longitude == null) continue;
    final d = LocationService.distanceMeters(fix.lat, fix.lng, s.latitude!, s.longitude!);
    if (d <= AppConfig.geofenceRadiusM && d < best) {
      best = d;
      onSite = s;
    }
  }
  if (!context.mounted) return;
  if (onSite != null) {
    await _showOnSiteSheet(context, onSite, fix.accuracyM);
  } else {
    messenger.showSnackBar(const SnackBar(content: Text('Vous n\'êtes à proximité d\'aucun site — sélectionnez-le manuellement.')));
    await router.push('/carburant/nouveau');
  }
}

/// Feuille d'affinage GPS : écoute le flux de positions et se ferme dès que la
/// précision atteint ~[_targetM] m (ou au bout de [_maxWait], avec la meilleure
/// mesure obtenue). L'utilisateur peut accepter tôt ou annuler.
class _GpsRefineSheet extends StatefulWidget {
  const _GpsRefineSheet();

  @override
  State<_GpsRefineSheet> createState() => _GpsRefineSheetState();
}

class _GpsRefineSheetState extends State<_GpsRefineSheet> {
  static const _targetM = 5.0;
  static const _maxWait = Duration(seconds: 30);

  StreamSubscription<GpsFix>? _sub;
  Timer? _timeout;
  GpsFix? _best;
  double? _current;

  @override
  void initState() {
    super.initState();
    _start();
  }

  Future<void> _start() async {
    final ok = await LocationService().ensurePermission();
    if (!mounted) return;
    if (!ok) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Localisation indisponible — activez le GPS (précision élevée).')),
      );
      Navigator.pop(context, null);
      return;
    }
    // Au bout du délai max, on part avec la meilleure mesure obtenue.
    _timeout = Timer(_maxWait, _finish);
    _sub = LocationService().preciseFixes().listen((f) {
      if (_best == null || f.accuracyM < _best!.accuracyM) _best = f;
      if (mounted) setState(() => _current = f.accuracyM);
      if (f.accuracyM <= _targetM) _finish();
    }, onError: (_) => _finish());
  }

  void _finish() {
    if (!mounted) return;
    Navigator.pop(context, _best);
  }

  @override
  void dispose() {
    _sub?.cancel();
    _timeout?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final acc = _current;
    final atteint = acc != null && acc <= _targetM;
    // Progression indicative : 30 m (ou pire) → 0 %, 5 m → 100 %.
    final progress = acc == null ? null : (1 - ((acc - _targetM) / 25)).clamp(0.0, 1.0);
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 18, 20, 14),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Icon(Icons.gps_fixed, color: atteint ? Colors.green : Colors.blueGrey),
              const SizedBox(width: 10),
              const Text('Affinage de la position…', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
            ]),
            const SizedBox(height: 14),
            Center(
              child: Text(
                acc == null ? 'Recherche du signal…' : '± ${acc.toStringAsFixed(0)} m',
                style: TextStyle(
                  fontSize: 30,
                  fontWeight: FontWeight.w800,
                  color: atteint ? Colors.green.shade700 : Colors.blueGrey.shade700,
                ),
              ),
            ),
            const SizedBox(height: 4),
            Center(
              child: Text('Objectif ~${_targetM.toStringAsFixed(0)} m — restez immobile, à découvert',
                  style: TextStyle(fontSize: 12, color: Colors.grey.shade600)),
            ),
            const SizedBox(height: 12),
            LinearProgressIndicator(value: progress, minHeight: 5, borderRadius: BorderRadius.circular(3)),
            const SizedBox(height: 12),
            Row(
              children: [
                TextButton(
                  onPressed: () {
                    _sub?.cancel();
                    _timeout?.cancel();
                    Navigator.pop(context, null);
                  },
                  child: const Text('Annuler'),
                ),
                const Spacer(),
                FilledButton.tonal(
                  onPressed: _best == null ? null : _finish,
                  child: Text(_best == null
                      ? 'Utiliser cette position'
                      : 'Utiliser (± ${_best!.accuracyM.toStringAsFixed(0)} m)'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

Future<void> _showOnSiteSheet(BuildContext context, Site site, double accuracyM) async {
  final repo = context.read<DepotageRepository>();
  final router = GoRouter.of(context);
  final lignes = await repo.getLignesLivraison(site.id);
  if (!context.mounted) return;
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (sheetCtx) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              const Icon(Icons.local_gas_station, color: Colors.green),
              const SizedBox(width: 8),
              Expanded(
                child: Text('Vous êtes sur le site\n${site.nom} (± ${accuracyM.toStringAsFixed(0)} m)',
                    style: const TextStyle(fontWeight: FontWeight.bold)),
              ),
            ]),
            const SizedBox(height: 12),
            if (lignes.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Text('Aucune livraison planifiée pour ce site.', style: TextStyle(color: Colors.grey.shade600)),
              )
            else ...[
              Text('Touchez une livraison à dépoter (${lignes.length})', style: const TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(height: 4),
              Flexible(
                child: ListView(
                  shrinkWrap: true,
                  children: lignes
                      .map((l) => ListTile(
                            contentPadding: EdgeInsets.zero,
                            leading: const Icon(Icons.local_shipping_outlined),
                            title: Text('${l.numeroBL ?? 'BL'} · ${l.volumePrevuLitres.toStringAsFixed(0)} L prévus'),
                            subtitle: l.restant > 0 ? Text('Reste à livrer : ${l.restant.toStringAsFixed(0)} L') : const Text('Soldée'),
                            trailing: const Icon(Icons.chevron_right),
                            onTap: () {
                              Navigator.pop(sheetCtx);
                              // Pré-rattache le dépotage à CETTE ligne → la livraison se solde.
                              router.push('/carburant/nouveau?siteId=${site.id}&ligneId=${l.id}');
                            },
                          ))
                      .toList(),
                ),
              ),
            ],
            const Divider(),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: () {
                  Navigator.pop(sheetCtx);
                  router.push('/carburant/nouveau?siteId=${site.id}');
                },
                icon: const Icon(Icons.add),
                label: const Text('Dépotage hors plan'),
              ),
            ),
          ],
        ),
      ),
    ),
  );
}
