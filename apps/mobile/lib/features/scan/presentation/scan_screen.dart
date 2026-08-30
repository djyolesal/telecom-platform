import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import '../../../core/theme/app_theme.dart';
import '../../maintenance/data/maintenance_repository.dart';

/// Scanner de QR codes E&M OpS collés sur les armoires et les GE.
///
/// Format des jetons (générés par la planche PDF côté web) :
///   EMOPS:SITE:<siteId>  → ouvre la fiche du site
///   EMOPS:GE:<geId>      → résout le site du GE puis ouvre sa fiche
class ScanScreen extends StatefulWidget {
  const ScanScreen({super.key});

  @override
  State<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends State<ScanScreen> with WidgetsBindingObserver {
  // detectionSpeed normal (pas noDuplicates) : le ré-scan du MÊME QR après une
  // erreur (« GE hors-ligne », zone blanche) doit re-déclencher - le doublon est
  // déjà bloqué par le drapeau _handling. Sinon « Réessayer » restait inopérant.
  final MobileScannerController _controller = MobileScannerController(
    detectionSpeed: DetectionSpeed.normal,
    formats: const [BarcodeFormat.qrCode],
  );
  bool _handling = false;
  String? _erreur;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  // Cycle de vie caméra : la relancer au retour d'arrière-plan (sinon flux figé).
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _controller.start();
    } else if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.inactive) {
      _controller.stop();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _controller.dispose();
    super.dispose();
  }

  Future<void> _onDetect(BarcodeCapture capture) async {
    if (_handling) return;
    final raw = capture.barcodes.map((b) => b.rawValue).firstWhere(
        (v) => v != null && v.startsWith('EMOPS:'),
        orElse: () => null);
    if (raw == null) return;

    setState(() {
      _handling = true;
      _erreur = null;
    });

    // EMOPS:SITE:<id> ou EMOPS:GE:<id> (l'id peut contenir des tirets, pas de « : »).
    final parts = raw.split(':');
    if (parts.length < 3) {
      _rejeter('QR non reconnu');
      return;
    }
    final type = parts[1];
    final id = parts.sublist(2).join(':');

    try {
      if (type == 'SITE') {
        if (!mounted) return;
        context.pushReplacement('/sites/$id');
        return;
      }
      if (type == 'GE') {
        final siteId = await context
            .read<MaintenanceRepository>()
            .resolveActifSiteId('GE', id);
        if (!mounted) return;
        if (siteId == null) {
          _rejeter('Ce GE n’est rattaché à aucun site (au dépôt).');
          return;
        }
        context.pushReplacement('/sites/$siteId');
        return;
      }
      _rejeter(
          'Cette étiquette n’est pas reconnue - vérifiez qu’il s’agit bien d’un QR E&M OpS.');
    } catch (_) {
      _rejeter('Équipement introuvable ou hors-ligne.');
    }
  }

  void _rejeter(String message) {
    if (!mounted) return;
    setState(() {
      _erreur = message;
      _handling = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        title: const Text('Scanner un équipement'),
        actions: [
          IconButton(
            icon: const Icon(Icons.flash_on),
            onPressed: () => _controller.toggleTorch(),
          ),
          IconButton(
            icon: const Icon(Icons.cameraswitch),
            onPressed: () => _controller.switchCamera(),
          ),
        ],
      ),
      body: Stack(
        alignment: Alignment.center,
        children: [
          MobileScanner(controller: _controller, onDetect: _onDetect),
          // Cadre de visée.
          Container(
            width: 240,
            height: 240,
            decoration: BoxDecoration(
              border: Border.all(
                  color: Colors.white.withValues(alpha: 0.9), width: 3),
              borderRadius: BorderRadius.circular(20),
            ),
          ),
          Positioned(
            bottom: 48,
            left: 24,
            right: 24,
            child: Column(
              children: [
                if (_handling && _erreur == null)
                  const Card(
                    color: Colors.white,
                    child: Padding(
                      padding: EdgeInsets.all(14),
                      child: Row(mainAxisSize: MainAxisSize.min, children: [
                        SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2)),
                        SizedBox(width: 12),
                        Text('Ouverture…'),
                      ]),
                    ),
                  )
                else if (_erreur != null)
                  Card(
                    color: AppColors.critique,
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Row(children: [
                        const Icon(Icons.error_outline,
                            color: Colors.white, size: 18),
                        const SizedBox(width: 10),
                        Expanded(
                            child: Text(_erreur!,
                                style: const TextStyle(color: Colors.white))),
                        TextButton(
                          onPressed: () => setState(() => _erreur = null),
                          child: const Text('Réessayer',
                              style: TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.bold)),
                        ),
                      ]),
                    ),
                  )
                else
                  const Card(
                    color: Colors.white,
                    child: Padding(
                      padding: EdgeInsets.all(14),
                      child: Text(
                        'Visez le QR collé sur l’armoire ou le GE',
                        textAlign: TextAlign.center,
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
