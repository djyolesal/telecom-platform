import 'package:flutter/foundation.dart';
import 'core/database/app_database.dart';
import 'core/network/dio_client.dart';
import 'core/network/network_info.dart';
import 'core/storage/secure_storage.dart';
import 'core/sync/sync_service.dart';
import 'core/services/upload_service.dart';
import 'core/services/fcm_service.dart';
import 'core/config/app_config.dart';
import 'features/auth/data/auth_repository.dart';
import 'features/sites/data/site_repository.dart';
import 'features/maintenance/data/maintenance_repository.dart';
import 'features/maintenance/data/maintenance_cache.dart';
import 'features/carburant/data/depotage_repository.dart';
import 'features/carburant/data/bon_livraison_repository.dart';
import 'features/energie/data/releve_repository.dart';
import 'features/incidents/data/incident_repository.dart';
import 'features/dashboard/data/dashboard_repository.dart';

/// Conteneur d'injection de dépendances (service locator simple).
/// Instancié une fois au démarrage et fourni aux providers.
class Injection {
  late final SecureStorage secureStorage;
  late final AppDatabase database;
  late final NetworkInfo networkInfo;
  late final DioClient dioClient;
  late final SyncService syncService;
  late final UploadService uploadService;
  late final ConfigService configService;

  late final AuthRepository authRepository;
  late final SiteRepository siteRepository;
  late final MaintenanceRepository maintenanceRepository;
  late final DepotageRepository depotageRepository;
  late final BonLivraisonRepository bonLivraisonRepository;
  late final ReleveRepository releveRepository;
  late final IncidentRepository incidentRepository;
  late final DashboardRepository dashboardRepository;
  late final FcmService fcmService;

  /// Callback déclenché quand la session expire (le refresh a échoué).
  VoidCallback? onSessionExpired;

  Future<void> init() async {
    secureStorage = SecureStorage();
    database = AppDatabase();
    networkInfo = NetworkInfo();
    dioClient = DioClient(secureStorage, onSessionExpired: () => onSessionExpired?.call());
    uploadService = UploadService(dioClient);
    configService = ConfigService(dioClient);
    syncService = SyncService(
      database, dioClient, networkInfo, uploadService, secureStorage,
      // Révocation du patch optimiste quand une opération finit en échec/abandon :
      // une maintenance affichée « Terminée » que le serveur a refusée est
      // marquée comme non synchronisée (l'écran cesse de mentir au technicien).
      onOptimistiqueEchoue: (ref) async {
        // Format : « maintenance:<id>:<statutAvant> ». On restaure le statut réel
        // (celui d'avant le patch optimiste) et on marque l'échec de synchro.
        final parts = ref.split(':');
        if (parts.length >= 2 && parts[0] == 'maintenance') {
          final avant = parts.length >= 3 ? parts[2] : '';
          await MaintenanceCache.patch(parts[1], {
            if (avant.isNotEmpty) 'statut': avant,
            '_syncEchoue': true,
          });
        }
      },
    )..start();

    authRepository = AuthRepository(dioClient, secureStorage);
    siteRepository = SiteRepository(dioClient, database, networkInfo);
    maintenanceRepository = MaintenanceRepository(dioClient, networkInfo, syncService);
    depotageRepository = DepotageRepository(dioClient, networkInfo, syncService);
    bonLivraisonRepository = BonLivraisonRepository(dioClient, networkInfo, syncService);
    releveRepository = ReleveRepository(dioClient, networkInfo, syncService);
    incidentRepository = IncidentRepository(dioClient, networkInfo, syncService);
    dashboardRepository = DashboardRepository(dioClient, networkInfo);
    fcmService = FcmService(authRepository);
  }
}
