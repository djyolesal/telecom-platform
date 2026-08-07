import 'package:flutter/material.dart';
import 'package:signature/signature.dart';
import '../theme/app_theme.dart';

/// Affiche un pavé de signature en plein écran et renvoie l'image PNG (Uint8List)
/// via Navigator.pop, ou null si annulé.
class SignaturePadScreen extends StatefulWidget {
  const SignaturePadScreen({super.key});

  @override
  State<SignaturePadScreen> createState() => _SignaturePadScreenState();
}

class _SignaturePadScreenState extends State<SignaturePadScreen> {
  late final SignatureController _controller;

  @override
  void initState() {
    super.initState();
    _controller = SignatureController(penStrokeWidth: 2.5, penColor: AppColors.brand);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _validate() async {
    if (_controller.isEmpty) {
      Navigator.pop(context);
      return;
    }
    final bytes = await _controller.toPngBytes();
    if (mounted) Navigator.pop(context, bytes);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Signature'),
        actions: [
          IconButton(onPressed: () => _controller.clear(), icon: const Icon(Icons.refresh)),
          IconButton(onPressed: _validate, icon: const Icon(Icons.check)),
        ],
      ),
      // SafeArea : sans elle, le bouton passait sous la barre de navigation
      // système sur les téléphones à navigation gestuelle.
      body: SafeArea(
        child: Column(
          children: [
            Expanded(child: Signature(controller: _controller, backgroundColor: Colors.white)),
            Padding(
              padding: const EdgeInsets.all(16),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton.icon(onPressed: _validate, icon: const Icon(Icons.check), label: const Text('Valider la signature')),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
