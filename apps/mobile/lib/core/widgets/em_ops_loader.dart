import 'package:flutter/material.dart';

/// Loader de marque E&M OpS : l'Écrou-signal « émet » (arcs séquencés) et la
/// Ligne de vie se trace en boucle comme un ECG. Respecte la préférence
/// « réduire les animations » (rendu statique).
class EmOpsLoader extends StatefulWidget {
  final double logoSize;
  final double width;
  final bool dark;
  final bool withLine;
  final String? label;

  const EmOpsLoader({
    super.key,
    this.logoSize = 54,
    this.width = 150,
    this.dark = false,
    this.withLine = true,
    this.label,
  });

  @override
  State<EmOpsLoader> createState() => _EmOpsLoaderState();
}

class _EmOpsLoaderState extends State<EmOpsLoader> with SingleTickerProviderStateMixin {
  late final AnimationController _c =
      AnimationController(vsync: this, duration: const Duration(milliseconds: 1800))..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final reduce = MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    if (reduce && _c.isAnimating) _c.stop();
    final size = Size(widget.width, widget.logoSize + (widget.withLine ? 26 : 0));
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (reduce)
          CustomPaint(size: size, painter: _LoaderPainter(0.999, widget.dark, widget.withLine, widget.logoSize))
        else
          AnimatedBuilder(
            animation: _c,
            builder: (_, __) => CustomPaint(
              size: size,
              painter: _LoaderPainter(_c.value, widget.dark, widget.withLine, widget.logoSize),
            ),
          ),
        if (widget.label != null) ...[
          const SizedBox(height: 10),
          Text(widget.label!,
              style: TextStyle(color: widget.dark ? const Color(0xFF9FB3C8) : Colors.grey.shade500, fontSize: 13)),
        ],
      ],
    );
  }
}

class _LoaderPainter extends CustomPainter {
  final double t;
  final bool dark;
  final bool withLine;
  final double logoSize;
  _LoaderPainter(this.t, this.dark, this.withLine, this.logoSize);

  static double _ramp(double t, double a, double b) => ((t - a) / (b - a)).clamp(0.0, 1.0);

  @override
  void paint(Canvas canvas, Size size) {
    final ink = dark ? Colors.white : const Color(0xFF1B3F6B);
    final sig = dark ? const Color(0xFF3BC9AF) : const Color(0xFF0E7C6B);
    final dot = dark ? const Color(0xFFFFB020) : const Color(0xFFF59E0B);

    // ── Écrou-signal (viewBox 120), arcs en émission séquencée ──
    final k = logoSize / 120;
    final ox = (size.width - logoSize) / 2;
    canvas.save();
    canvas.translate(ox, 0);
    canvas.scale(k);

    final hex = Path()
      ..moveTo(104, 60)
      ..lineTo(82, 98)
      ..lineTo(38, 98)
      ..lineTo(16, 60)
      ..lineTo(38, 22)
      ..lineTo(82, 22)
      ..close();
    canvas.drawPath(
      hex,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 9
        ..strokeJoin = StrokeJoin.round
        ..color = ink,
    );
    canvas.drawCircle(const Offset(60, 64), 7, Paint()..color = dot);

    // Arc 1 puis arc 2 apparaissent, puis tout s'éteint → boucle « émission ».
    final o1 = _ramp(t, 0.08, 0.26) * (1 - _ramp(t, 0.82, 1.0));
    final o2 = _ramp(t, 0.34, 0.52) * (1 - _ramp(t, 0.82, 1.0));
    Paint arc(double o) => Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 6.5
      ..strokeCap = StrokeCap.round
      ..color = sig.withValues(alpha: o);
    if (o1 > 0) {
      canvas.drawArc(Rect.fromCircle(center: const Offset(60, 63.31), radius: 18), 3.820, 1.784, false, arc(o1));
    }
    if (o2 > 0) {
      canvas.drawArc(Rect.fromCircle(center: const Offset(60, 60), radius: 25), 3.785, 1.855, false, arc(o2));
    }
    canvas.restore();

    // ── Ligne de vie qui se trace (ECG) ──
    if (!withLine) return;
    final y = logoSize + 16;
    final w = size.width;
    final line = Path()
      ..moveTo(6, y)
      ..lineTo(w * 0.52, y)
      ..relativeLineTo(6, -11)
      ..relativeLineTo(9, 18)
      ..relativeLineTo(7, -8)
      ..lineTo(w - 16, y);
    final metrics = line.computeMetrics().toList();
    if (metrics.isEmpty) return;
    final metric = metrics.first;
    final tt = Curves.easeInOut.transform(t);
    final drawn = metric.extractPath(0, metric.length * tt);
    canvas.drawPath(
      drawn,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.6
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round
        ..color = dot,
    );
    final tip = metric.getTangentForOffset(metric.length * tt)?.position;
    if (tip != null) canvas.drawCircle(tip, 3.4, Paint()..color = sig);
  }

  @override
  bool shouldRepaint(covariant _LoaderPainter old) =>
      old.t != t || old.dark != dark || old.withLine != withLine || old.logoSize != logoSize;
}
