import 'package:flutter/material.dart';

/// Logo « Écrou-signal » E&M OpS : un écrou hexagonal (la maintenance)
/// dont le cœur émet un signal (la connectivité). Tracé vectoriel,
/// identique au SVG du portail web (viewBox 120×120).
class AppLogo extends StatelessWidget {
  final double size;

  /// true = tracés blancs (fond marine), false = palette sur fond clair.
  final bool dark;

  const AppLogo({super.key, this.size = 64, this.dark = false});

  @override
  Widget build(BuildContext context) =>
      CustomPaint(size: Size.square(size), painter: _EcrouSignalPainter(dark));
}

class _EcrouSignalPainter extends CustomPainter {
  final bool dark;
  _EcrouSignalPainter(this.dark);

  @override
  void paint(Canvas canvas, Size size) {
    final k = size.width / 120;
    final ink = dark ? Colors.white : const Color(0xFF1B3F6B);
    final sig = dark ? const Color(0xFF3BC9AF) : const Color(0xFF0E7C6B);
    final dot = dark ? const Color(0xFFFFB020) : const Color(0xFFF59E0B);

    // Écrou hexagonal.
    final hex = Path()
      ..moveTo(104 * k, 60 * k)
      ..lineTo(82 * k, 98 * k)
      ..lineTo(38 * k, 98 * k)
      ..lineTo(16 * k, 60 * k)
      ..lineTo(38 * k, 22 * k)
      ..lineTo(82 * k, 22 * k)
      ..close();
    canvas.drawPath(
      hex,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 9 * k
        ..strokeJoin = StrokeJoin.round
        ..color = ink,
    );

    // Cœur (point ambre).
    canvas.drawCircle(Offset(60 * k, 64 * k), 7 * k, Paint()..color = dot);

    // Ondes du signal (arcs teal) — mêmes cordes que le SVG :
    // corde (46,52)-(74,52) r18 → centre (60, 63.31) ; corde (40,45)-(80,45) r25 → centre (60, 60).
    final arc = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 6.5 * k
      ..strokeCap = StrokeCap.round
      ..color = sig;
    canvas.drawArc(Rect.fromCircle(center: Offset(60 * k, 63.31 * k), radius: 18 * k), 3.820, 1.784, false, arc);
    canvas.drawArc(Rect.fromCircle(center: Offset(60 * k, 60 * k), radius: 25 * k), 3.785, 1.855, false, arc);
  }

  @override
  bool shouldRepaint(covariant _EcrouSignalPainter old) => old.dark != dark;
}

/// Nom de l'app « E&M OpS » avec le « OpS » en teal.
class AppWordmark extends StatelessWidget {
  final double fontSize;
  final bool dark;
  const AppWordmark({super.key, this.fontSize = 22, this.dark = false});

  @override
  Widget build(BuildContext context) {
    final ink = dark ? Colors.white : const Color(0xFF1B3F6B);
    final ops = dark ? const Color(0xFF3BC9AF) : const Color(0xFF0E7C6B);
    return Text.rich(
      TextSpan(children: [
        TextSpan(text: 'E&M ', style: TextStyle(color: ink)),
        TextSpan(text: 'OpS', style: TextStyle(color: ops)),
      ]),
      style: TextStyle(fontSize: fontSize, fontWeight: FontWeight.w800, letterSpacing: -0.5),
    );
  }
}
