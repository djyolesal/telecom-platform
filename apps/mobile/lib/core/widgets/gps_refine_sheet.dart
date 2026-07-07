import 'dart:async';
import 'package:flutter/material.dart';
import '../services/location_service.dart';
import 'em_ops_loader.dart';

/// Ouvre IMMÉDIATEMENT la feuille d'affinage GPS (loader de marque affiché
/// pendant toute l'acquisition) et retourne la position affinée (~5 m visés),
/// ou null si annulé / GPS indisponible.
Future<GpsFix?> refineGpsPosition(BuildContext context) {
  return showModalBottomSheet<GpsFix>(
    context: context,
    isDismissible: false,
    enableDrag: false,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
    builder: (_) => const GpsRefineSheet(),
  );
}

/// Feuille d'affinage GPS : écoute le flux de positions et se ferme dès que la
/// précision atteint ~[_targetM] m (ou au bout de [_maxWait], avec la meilleure
/// mesure obtenue). L'utilisateur peut accepter tôt ou annuler.
class GpsRefineSheet extends StatefulWidget {
  const GpsRefineSheet({super.key});

  @override
  State<GpsRefineSheet> createState() => _GpsRefineSheetState();
}

class _GpsRefineSheetState extends State<GpsRefineSheet> {
  static const _targetM = 5.0;
  static const _maxWait = Duration(seconds: 30);

  StreamSubscription<GpsFix>? _sub;
  Timer? _timeout;
  GpsFix? _best;
  double? _current;

  @override
  void initState() {
    super.initState();
    // Démarre APRÈS le premier rendu : la feuille (et son loader) s'affiche
    // d'abord, l'éventuel dialogue de permission apparaît par-dessus.
    WidgetsBinding.instance.addPostFrameCallback((_) => _start());
  }

  Future<void> _start() async {
    if (!mounted) return;
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
    }, onError: (_) => _fallback());
  }

  /// Le flux haute précision a échoué (ex. permission « approximative ») :
  /// repli sur une mesure GPS classique plutôt qu'un abandon silencieux.
  Future<void> _fallback() async {
    if (_best != null) return _finish();
    final pos = await LocationService().freshPosition();
    if (!mounted) return;
    if (pos != null) {
      Navigator.pop(context, (lat: pos.lat, lng: pos.lng, accuracyM: -1.0)); // précision inconnue
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Position GPS indisponible — réessayez à découvert.')),
      );
      Navigator.pop(context, null);
    }
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
    final progress = acc == null ? null : (1 - ((acc - _targetM) / 25)).clamp(0.0, 1.0).toDouble();
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 18, 20, 14),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              const Text('Affinage de la position…', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
              const Spacer(),
              Icon(Icons.gps_fixed, size: 18, color: atteint ? Colors.green : Colors.blueGrey.shade300),
            ]),
            const SizedBox(height: 16),
            // Loader de marque affiché pendant TOUTE l'acquisition.
            const Center(child: EmOpsLoader(logoSize: 60, width: 170)),
            const SizedBox(height: 14),
            Center(
              child: Text(
                acc == null ? 'Acquisition du signal GPS…' : '± ${acc.toStringAsFixed(0)} m',
                style: TextStyle(
                  fontSize: acc == null ? 15 : 30,
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
