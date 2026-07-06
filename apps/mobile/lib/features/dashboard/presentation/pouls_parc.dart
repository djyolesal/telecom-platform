import 'dart:math' as math;
import 'package:flutter/material.dart';

/// « Pouls du parc » : la Ligne de vie porte l'état du stock des sites —
/// le battement se positionne à la frontière de la zone en tension, au-dessus
/// d'une jauge OK / stock faible / critique.
class PoulsParc extends StatelessWidget {
  final int ok;
  final int faible;
  final int critique;
  final num stockTotalLitres;
  final VoidCallback? onTap;

  const PoulsParc({
    super.key,
    required this.ok,
    required this.faible,
    required this.critique,
    required this.stockTotalLitres,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    const tealL = Color(0xFF3BC9AF);
    const amber = Color(0xFFFFB020);
    const red = Color(0xFFF87171);
    final stockK = (stockTotalLitres / 1000).round();

    Widget stat(String value, String label, Color color) => Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(value, style: TextStyle(color: color, fontWeight: FontWeight.w800, fontSize: 15)),
            Text(label, style: const TextStyle(color: Color(0xFFC6D5E4), fontSize: 10)),
          ],
        );

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Ink(
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [Color(0xFF1B3F6B), Color(0xFF122C4E)],
            ),
            borderRadius: BorderRadius.circular(16),
          ),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('POULS DU PARC',
                        style: TextStyle(color: Color(0xFF9FB3C8), fontSize: 10, fontWeight: FontWeight.w700, letterSpacing: 1.4)),
                    if (onTap != null)
                      const Text('Voir les sites →', style: TextStyle(color: tealL, fontSize: 10.5)),
                  ],
                ),
                SizedBox(
                  height: 36,
                  width: double.infinity,
                  child: CustomPaint(painter: _PoulsPainter(ok: ok, faible: faible, critique: critique)),
                ),
                // Jauge OK / faible / critique (segments proportionnels).
                ClipRRect(
                  borderRadius: BorderRadius.circular(4),
                  child: SizedBox(
                    height: 7,
                    child: Row(children: [
                      if (ok > 0) Expanded(flex: ok, child: const ColoredBox(color: Color(0xFF0E7C6B))),
                      if (faible > 0) Expanded(flex: faible, child: const ColoredBox(color: Color(0xFFF59E0B))),
                      if (critique > 0) Expanded(flex: critique, child: const ColoredBox(color: Color(0xFFDC2626))),
                      if (ok + faible + critique == 0) const Expanded(child: ColoredBox(color: Color(0xFF3A5573))),
                    ]),
                  ),
                ),
                const SizedBox(height: 9),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    stat('$ok', 'OK', Colors.white),
                    stat('$faible', 'stock faible', amber),
                    stat('$critique', 'critiques', red),
                    stat('${stockK}k L', 'stock total', Colors.white),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _PoulsPainter extends CustomPainter {
  final int ok;
  final int faible;
  final int critique;
  _PoulsPainter({required this.ok, required this.faible, required this.critique});

  @override
  void paint(Canvas canvas, Size size) {
    const tealL = Color(0xFF3BC9AF);
    const amber = Color(0xFFFFB020);
    const red = Color(0xFFF87171);
    final total = math.max(1, ok + faible + critique);
    final y = size.height * 0.62;
    final usable = size.width - 44; // marge pour le battement + le point
    // Le battement se place à la frontière saine → tension (fraction de sites OK).
    final spikeX = 4 + usable * (ok / total).clamp(0.12, 0.78);

    Paint stroke(Color c) => Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.6
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..color = c;

    // Segment sain.
    canvas.drawLine(Offset(4, y), Offset(spikeX, y), stroke(tealL));
    // Battement (ambre).
    final spike = Path()
      ..moveTo(spikeX, y)
      ..relativeLineTo(6, -12)
      ..relativeLineTo(8, 20)
      ..relativeLineTo(6, -9)
      ..relativeLineTo(1, 1);
    canvas.drawPath(spike, stroke(amber));
    // Queue : colorée selon la pire tension.
    final tail = critique > 0 ? red : (faible > 0 ? amber : tealL);
    canvas.drawLine(Offset(spikeX + 22, y), Offset(size.width - 16, y), stroke(tail));
    canvas.drawCircle(Offset(size.width - 7, y), 3.6, Paint()..color = tail);
  }

  @override
  bool shouldRepaint(covariant _PoulsPainter old) =>
      old.ok != ok || old.faible != faible || old.critique != critique;
}
