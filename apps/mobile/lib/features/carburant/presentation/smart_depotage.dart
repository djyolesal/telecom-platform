import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import '../../../core/config/app_config.dart';
import '../../../core/services/location_service.dart';
import '../../sites/data/site_model.dart';
import '../../sites/data/site_repository.dart';
import '../data/depotage_repository.dart';

/// Dépotage intelligent : détecte si le technicien est SUR un site (GPS),
/// montre ses livraisons planifiées (chaque ligne lance un dépotage
/// pré-rattaché) ; sinon le notifie et ouvre le formulaire vierge.
/// Utilisé par la liste des dépotages (FAB) et par le tableau de bord.
Future<void> smartDepoter(BuildContext context) async {
  final messenger = ScaffoldMessenger.of(context);
  final router = GoRouter.of(context);
  final siteRepo = context.read<SiteRepository>();
  // Indicateur persistant pendant le fix GPS (jusqu'à 12 s) : reste affiché
  // tant que la position n'est pas résolue, puis on le masque.
  messenger.showSnackBar(const SnackBar(
    content: Row(children: [
      SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)),
      SizedBox(width: 12),
      Text('Localisation en cours…'),
    ]),
    duration: Duration(seconds: 15),
  ));
  final pos = await LocationService().freshPosition();
  final sites = await siteRepo.getSites();
  messenger.hideCurrentSnackBar();
  Site? onSite;
  double best = double.infinity;
  if (pos != null) {
    for (final s in sites) {
      if (s.latitude == null || s.longitude == null) continue;
      final d = LocationService.distanceMeters(pos.lat, pos.lng, s.latitude!, s.longitude!);
      if (d <= AppConfig.geofenceRadiusM && d < best) {
        best = d;
        onSite = s;
      }
    }
  }
  if (!context.mounted) return;
  if (onSite != null) {
    await _showOnSiteSheet(context, onSite);
  } else {
    messenger.showSnackBar(const SnackBar(content: Text('Vous n\'êtes à proximité d\'aucun site — sélectionnez-le manuellement.')));
    await router.push('/carburant/nouveau');
  }
}

Future<void> _showOnSiteSheet(BuildContext context, Site site) async {
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
              Expanded(child: Text('Vous êtes sur le site\n${site.nom}', style: const TextStyle(fontWeight: FontWeight.bold))),
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
