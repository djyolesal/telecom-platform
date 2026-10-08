import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:flutter_image_compress/flutter_image_compress.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';

import '../utils/jpeg.dart';

/// Prend une photo avec l'APPAREIL PHOTO INTÉGRÉ à l'application.
///
/// Pourquoi pas celui du téléphone : sur certains Android d'entrée de gamme,
/// l'appareil photo système ignore le fichier que l'application lui demande de
/// remplir et ne rend que sa miniature (~200 × 150 px). Des photos de dépotage
/// arrivaient ainsi illisibles, sans que rien côté plateforme ne les ait
/// réduites. Ici la capture passe par la caméra elle-même (CameraX).
///
/// La photo est ensuite ramenée à [coteMax] px sur son grand côté, en qualité
/// [qualite], et redressée (l'orientation EXIF est appliquée aux pixels) : les
/// mêmes réglages qu'avant, pour un poids d'envoi inchangé sur le réseau.
///
/// Repli : pas de caméra utilisable, ou accès refusé et le technicien choisit
/// de continuer → appareil photo du téléphone, comme avant. On ne bloque
/// jamais une clôture faute de photo.
Future<XFile?> prendrePhoto(
  BuildContext context, {
  int coteMax = 2000,
  int qualite = 70,
}) async {
  final resultat = await Navigator.of(context).push<_Resultat>(
    MaterialPageRoute(
      fullscreenDialog: true,
      builder: (_) => AppareilPhotoScreen(coteMax: coteMax, qualite: qualite),
    ),
  );
  if (resultat == null) return null;
  if (resultat.repli) {
    return ImagePicker().pickImage(
      source: ImageSource.camera,
      maxWidth: coteMax.toDouble(),
      maxHeight: coteMax.toDouble(),
      imageQuality: qualite,
    );
  }
  return resultat.photo;
}

class _Resultat {
  final XFile? photo;
  final bool repli;
  const _Resultat.photo(this.photo) : repli = false;
  const _Resultat.repli()
      : photo = null,
        repli = true;
}

/// Ramène une photo capturée à [coteMax] px, qualité [qualite], redressée.
/// En cas d'échec de la compression, la photo d'origine est gardée telle
/// quelle : plus lourde, mais jamais perdue.
Future<XFile> normaliserPhoto(XFile brute, {required int coteMax, required int qualite}) async {
  try {
    final octets = await brute.readAsBytes();
    final d = dimensionsJpeg(octets);
    final cible = d == null ? coteMax : cibleCompression(d.largeur, d.hauteur, coteMax);
    final Uint8List sortie = await FlutterImageCompress.compressWithList(
      octets,
      minWidth: cible,
      minHeight: cible,
      quality: qualite,
      autoCorrectionAngle: true,
      format: CompressFormat.jpeg,
    );
    if (sortie.isEmpty) return brute;
    final dir = await getTemporaryDirectory();
    final f = File('${dir.path}/photo-${DateTime.now().microsecondsSinceEpoch}.jpg');
    await f.writeAsBytes(sortie, flush: true);
    return XFile(f.path, mimeType: 'image/jpeg');
  } catch (_) {
    return brute;
  }
}

class AppareilPhotoScreen extends StatefulWidget {
  final int coteMax;
  final int qualite;
  const AppareilPhotoScreen({super.key, required this.coteMax, required this.qualite});

  @override
  State<AppareilPhotoScreen> createState() => _AppareilPhotoScreenState();
}

const _delaiDemarrage = Duration(seconds: 10);

class _AppareilPhotoScreenState extends State<AppareilPhotoScreen> with WidgetsBindingObserver {
  CameraController? _controleur;
  String? _erreur;
  bool _accesRefuse = false;
  bool _capture = false;
  // La demande d'autorisation rend l'appli « inactive » puis « resumed » PENDANT
  // l'initialisation : sans ce verrou, le retour lancerait une seconde caméra.
  bool _enDemarrage = false;
  XFile? _apercu;

  FlashMode _flash = FlashMode.off;
  double _zoom = 1, _zoomMin = 1, _zoomMax = 1, _zoomDebut = 1;
  Offset? _pointMiseAuPoint;
  Timer? _effacerPoint;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _demarrer();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _effacerPoint?.cancel();
    _controleur?.dispose();
    super.dispose();
  }

  // La caméra est libérée en arrière-plan (appel entrant, autre appli) et
  // relancée au retour : sinon l'aperçu reste figé ou la caméra occupée.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final c = _controleur;
    if (state == AppLifecycleState.inactive || state == AppLifecycleState.paused) {
      if (c != null) {
        _controleur = null;
        c.dispose();
        if (mounted) setState(() {});
      }
    } else if (state == AppLifecycleState.resumed && _controleur == null && _apercu == null && !_accesRefuse && !_enDemarrage) {
      _demarrer();
    }
  }

  Future<void> _demarrer() async {
    if (_enDemarrage) return;
    _enDemarrage = true;
    try {
      // Borné : une caméra qui ne répond pas (pilote capricieux, caméra tenue
      // par une autre appli) ne doit pas laisser le technicien devant un
      // sablier - au bout du délai, l'écran de repli s'affiche.
      final cameras = await availableCameras().timeout(_delaiDemarrage);
      if (cameras.isEmpty) {
        // Aucune caméra exploitable par l'application : celle du téléphone prend le relais.
        if (mounted) Navigator.of(context).pop(const _Resultat.repli());
        return;
      }
      final arriere = cameras.firstWhere(
        (c) => c.lensDirection == CameraLensDirection.back,
        orElse: () => cameras.first,
      );
      // ~1080p suffit aux photos (plafonnées à 2000 px), ~2160p pour un document
      // (bon de livraison, plafonné à 2400 px) : capturer plus grand ne ferait
      // que ralentir les téléphones modestes.
      final c = CameraController(
        arriere,
        widget.coteMax > 2000 ? ResolutionPreset.ultraHigh : ResolutionPreset.veryHigh,
        enableAudio: false,
        imageFormatGroup: ImageFormatGroup.jpeg,
      );
      await c.initialize().timeout(_delaiDemarrage, onTimeout: () async {
        await c.dispose();
        throw TimeoutException('initialisation caméra');
      });
      final zoomMin = await c.getMinZoomLevel().catchError((_) => 1.0);
      final zoomMax = await c.getMaxZoomLevel().catchError((_) => 1.0);
      await c.setFlashMode(_flash).catchError((_) {});
      if (!mounted) {
        await c.dispose();
        return;
      }
      setState(() {
        _controleur = c;
        _erreur = null;
        _zoomMin = zoomMin;
        _zoomMax = zoomMax.clamp(1, 8).toDouble();
        _zoom = zoomMin;
      });
    } on CameraException catch (e) {
      if (!mounted) return;
      final refus = e.code.startsWith('CameraAccess');
      setState(() {
        _accesRefuse = refus;
        _erreur = refus
            ? 'L’application n’a pas accès à l’appareil photo. Autorisez-le dans les réglages du téléphone, ou utilisez l’appareil photo du téléphone.'
            : 'Appareil photo indisponible (${e.description ?? e.code}).';
      });
    } on TimeoutException {
      if (mounted) setState(() => _erreur = 'L’appareil photo ne répond pas.');
    } catch (e) {
      if (mounted) setState(() => _erreur = 'Appareil photo indisponible.');
    } finally {
      _enDemarrage = false;
    }
  }

  Future<void> _declencher() async {
    final c = _controleur;
    if (c == null || !c.value.isInitialized || _capture) return;
    setState(() => _capture = true);
    try {
      final brute = await c.takePicture();
      final photo = await normaliserPhoto(brute, coteMax: widget.coteMax, qualite: widget.qualite);
      if (!mounted) return;
      setState(() => _apercu = photo);
      await c.pausePreview().catchError((_) {});
    } on CameraException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Photo non prise (${e.description ?? e.code}). Réessayez.')),
        );
      }
    } finally {
      if (mounted) setState(() => _capture = false);
    }
  }

  Future<void> _reprendre() async {
    setState(() => _apercu = null);
    // Caméra libérée entre-temps (appli passée en arrière-plan) : on la relance.
    if (_controleur == null) {
      await _demarrer();
    } else {
      await _controleur!.resumePreview().catchError((_) {});
    }
  }

  Future<void> _changerFlash() async {
    const cycle = [FlashMode.off, FlashMode.auto, FlashMode.torch];
    final suivant = cycle[(cycle.indexOf(_flash) + 1) % cycle.length];
    try {
      await _controleur?.setFlashMode(suivant);
      setState(() => _flash = suivant);
    } on CameraException {
      // Pas de flash sur cet appareil : on reste sur l'état courant.
    }
  }

  Future<void> _mettreAuPoint(TapUpDetails d, BoxConstraints taille) async {
    final c = _controleur;
    if (c == null) return;
    final point = Offset(
      d.localPosition.dx / taille.maxWidth,
      d.localPosition.dy / taille.maxHeight,
    );
    setState(() => _pointMiseAuPoint = d.localPosition);
    _effacerPoint?.cancel();
    _effacerPoint = Timer(const Duration(milliseconds: 900), () {
      if (mounted) setState(() => _pointMiseAuPoint = null);
    });
    try {
      if (c.value.focusPointSupported) await c.setFocusPoint(point);
      if (c.value.exposurePointSupported) await c.setExposurePoint(point);
    } on CameraException {
      // Mise au point manuelle non prise en charge : l'autofocus continu reste actif.
    }
  }

  Future<void> _zoomer(double niveau) async {
    final z = niveau.clamp(_zoomMin, _zoomMax).toDouble();
    if (z == _zoom) return;
    setState(() => _zoom = z);
    await _controleur?.setZoomLevel(z).catchError((_) {});
  }

  IconData get _iconeFlash => switch (_flash) {
        FlashMode.auto => Icons.flash_auto,
        FlashMode.torch => Icons.highlight,
        _ => Icons.flash_off,
      };

  String get _libelleFlash => switch (_flash) {
        FlashMode.auto => 'Flash auto',
        FlashMode.torch => 'Torche',
        _ => 'Sans flash',
      };

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: _apercu != null ? _vueApercu(_apercu!) : (_erreur != null ? _vueErreur() : _vueCamera()),
      ),
    );
  }

  Widget _vueCamera() {
    final c = _controleur;
    if (c == null || !c.value.isInitialized) {
      return Stack(
        children: [
          const Center(child: CircularProgressIndicator(color: Colors.white)),
          Positioned(
            top: 4,
            left: 8,
            child: IconButton(
              icon: const Icon(Icons.close, color: Colors.white),
              tooltip: 'Annuler',
              onPressed: () => Navigator.of(context).pop(),
            ),
          ),
        ],
      );
    }
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          child: Row(
            children: [
              IconButton(
                icon: const Icon(Icons.close, color: Colors.white),
                tooltip: 'Annuler',
                onPressed: () => Navigator.of(context).pop(),
              ),
              const Spacer(),
              TextButton.icon(
                onPressed: _changerFlash,
                icon: Icon(_iconeFlash, color: Colors.white),
                label: Text(_libelleFlash, style: const TextStyle(color: Colors.white)),
              ),
            ],
          ),
        ),
        Expanded(
          child: Center(
            child: AspectRatio(
              // L'aperçu est donné en paysage : on l'affiche en portrait.
              aspectRatio: 1 / c.value.aspectRatio,
              child: LayoutBuilder(
                builder: (context, taille) => GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onScaleStart: (_) => _zoomDebut = _zoom,
                  onScaleUpdate: (d) => _zoomer(_zoomDebut * d.scale),
                  onTapUp: (d) => _mettreAuPoint(d, taille),
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      CameraPreview(c),
                      if (_pointMiseAuPoint != null)
                        Positioned(
                          left: _pointMiseAuPoint!.dx - 32,
                          top: _pointMiseAuPoint!.dy - 32,
                          child: Container(
                            width: 64,
                            height: 64,
                            decoration: BoxDecoration(
                              border: Border.all(color: Colors.amberAccent, width: 2),
                              borderRadius: BorderRadius.circular(8),
                            ),
                          ),
                        ),
                      if (_zoomMax > _zoomMin)
                        Positioned(
                          bottom: 12,
                          left: 0,
                          right: 0,
                          child: Center(
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                              decoration: BoxDecoration(
                                color: Colors.black54,
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Text(
                                '×${_zoom.toStringAsFixed(1)}',
                                style: const TextStyle(color: Colors.white, fontSize: 13),
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
        const Padding(
          padding: EdgeInsets.only(top: 8),
          child: Text(
            'Touchez pour faire la mise au point · pincez pour zoomer',
            style: TextStyle(color: Colors.white60, fontSize: 12),
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 18),
          child: GestureDetector(
            onTap: _declencher,
            child: Container(
              width: 76,
              height: 76,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(color: Colors.white, width: 4),
              ),
              padding: const EdgeInsets.all(5),
              child: _capture
                  ? const CircularProgressIndicator(color: Colors.white, strokeWidth: 3)
                  : const DecoratedBox(
                      decoration: BoxDecoration(shape: BoxShape.circle, color: Colors.white),
                    ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _vueApercu(XFile photo) {
    return Column(
      children: [
        Expanded(
          child: InteractiveViewer(
            maxScale: 6,
            child: Center(child: Image.file(File(photo.path), fit: BoxFit.contain)),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
          child: Row(
            children: [
              // Expanded autour de chaque bouton : le thème donne aux boutons
              // une largeur minimale infinie (piège déjà rencontré en b19).
              Expanded(
                child: OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                    foregroundColor: Colors.white,
                    side: const BorderSide(color: Colors.white54),
                  ),
                  onPressed: _reprendre,
                  icon: const Icon(Icons.refresh),
                  label: const Text('Reprendre'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: FilledButton.icon(
                  onPressed: () => Navigator.of(context).pop(_Resultat.photo(photo)),
                  icon: const Icon(Icons.check),
                  label: const Text('Utiliser'),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _vueErreur() {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Icon(Icons.no_photography_outlined, color: Colors.white70, size: 48),
          const SizedBox(height: 16),
          Text(_erreur!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 15)),
          const SizedBox(height: 24),
          FilledButton.icon(
            onPressed: () => Navigator.of(context).pop(const _Resultat.repli()),
            icon: const Icon(Icons.photo_camera_outlined),
            label: const Text('Utiliser l’appareil photo du téléphone'),
          ),
          if (!_accesRefuse) ...[
            const SizedBox(height: 8),
            TextButton(
              onPressed: () {
                setState(() => _erreur = null);
                _demarrer();
              },
              child: const Text('Réessayer', style: TextStyle(color: Colors.white70)),
            ),
          ],
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Annuler', style: TextStyle(color: Colors.white70)),
          ),
        ],
      ),
    );
  }
}
