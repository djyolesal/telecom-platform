import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import 'em_ops_loader.dart';

/// Indicateur de chargement centré (loader de marque : Écrou-signal + Ligne de vie).
class LoadingView extends StatelessWidget {
  final String? label;
  const LoadingView({super.key, this.label});

  @override
  Widget build(BuildContext context) {
    return Center(child: EmOpsLoader(label: label));
  }
}

/// Vue vide / message d'absence de données.
class EmptyView extends StatelessWidget {
  final String title;
  final String? hint;
  final IconData icon;
  const EmptyView({super.key, required this.title, this.hint, this.icon = Icons.inbox_outlined});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 40, color: Colors.grey.shade300),
            const SizedBox(height: 10),
            Text(title, style: TextStyle(color: Colors.grey.shade600, fontWeight: FontWeight.w500)),
            if (hint != null) ...[
              const SizedBox(height: 4),
              Text(hint!, textAlign: TextAlign.center, style: TextStyle(color: Colors.grey.shade400, fontSize: 12)),
            ],
          ],
        ),
      ),
    );
  }
}

/// Vue d'erreur avec bouton réessayer.
class ErrorView extends StatelessWidget {
  final String message;
  final VoidCallback? onRetry;
  const ErrorView({super.key, required this.message, this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.error_outline, size: 40, color: Colors.red.shade300),
          const SizedBox(height: 10),
          Text(message, textAlign: TextAlign.center, style: TextStyle(color: Colors.red.shade400)),
          if (onRetry != null) ...[
            const SizedBox(height: 12),
            OutlinedButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh, size: 16), label: const Text('Réessayer')),
          ],
        ],
      ),
    );
  }
}

/// Pastille de statut colorée.
class StatusChip extends StatelessWidget {
  final String label;
  final Color color;
  const StatusChip({super.key, required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(label, style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w600)),
    );
  }
}

/// Bannière hors-ligne / opérations en attente.
class OfflineBanner extends StatelessWidget {
  final int pendingCount;
  const OfflineBanner({super.key, required this.pendingCount});

  @override
  Widget build(BuildContext context) {
    if (pendingCount == 0) return const SizedBox.shrink();
    return Container(
      width: double.infinity,
      color: AppColors.majeur.withValues(alpha: 0.15),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: Row(
        children: [
          const Icon(Icons.cloud_off, size: 16, color: AppColors.majeur),
          const SizedBox(width: 8),
          Text('$pendingCount opération(s) en attente de synchronisation',
              style: const TextStyle(fontSize: 12, color: AppColors.majeur)),
        ],
      ),
    );
  }
}

/// Carte d'indicateur (KPI) pour le tableau de bord.
class StatTile extends StatelessWidget {
  final String title;
  final String value;
  final IconData icon;
  final Color color;
  const StatTile({super.key, required this.title, required this.value, required this.icon, required this.color});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              padding: const EdgeInsets.all(7),
              decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(10)),
              child: Icon(icon, color: Colors.white, size: 18),
            ),
            const SizedBox(height: 6),
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(value, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
            ),
            Text(title, maxLines: 1, overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 11, color: Colors.grey.shade500)),
          ],
        ),
      ),
    );
  }
}
