import 'dart:async';
import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';
import '../../features/auth/presentation/auth_cubit.dart';
import '../../features/auth/presentation/login_screen.dart';
import '../../features/dashboard/presentation/dashboard_screen.dart';
import '../../features/sites/presentation/sites_list_screen.dart';
import '../../features/sites/presentation/site_detail_screen.dart';
import '../../features/maintenance/presentation/maintenance_list_screen.dart';
import '../../features/maintenance/presentation/maintenance_form_screen.dart';
import '../../features/maintenance/presentation/maintenance_detail_screen.dart';
import '../../features/carburant/presentation/depotage_list_screen.dart';
import '../../features/carburant/presentation/depotage_form_screen.dart';
import '../../features/carburant/presentation/bl_form_screen.dart';
import '../../features/energie/presentation/releve_list_screen.dart';
import '../../features/energie/presentation/releve_form_screen.dart';
import '../../features/incidents/presentation/incidents_list_screen.dart';
import '../../features/incidents/presentation/incident_form_screen.dart';
import '../../features/incidents/presentation/incident_detail_screen.dart';

GoRouter createRouter(AuthCubit authCubit) {
  return GoRouter(
    initialLocation: '/dashboard',
    refreshListenable: _GoRouterRefreshStream(authCubit.stream),
    redirect: (context, state) {
      final authed = authCubit.state.status == AuthStatus.authenticated;
      final loggingIn = state.matchedLocation == '/login';
      if (!authed) return loggingIn ? null : '/login';
      if (loggingIn) return '/dashboard';
      return null;
    },
    routes: [
      GoRoute(path: '/login', builder: (_, __) => const LoginScreen()),
      GoRoute(path: '/dashboard', builder: (_, __) => const DashboardScreen()),

      // Sites
      GoRoute(path: '/sites', builder: (_, __) => const SitesListScreen()),
      GoRoute(path: '/sites/:id', builder: (_, s) => SiteDetailScreen(siteId: s.pathParameters['id']!)),

      // Maintenance (nouveau avant :id)
      GoRoute(path: '/maintenance', builder: (_, __) => const MaintenanceListScreen()),
      GoRoute(path: '/maintenance/nouveau', builder: (_, s) => MaintenanceFormScreen(initialSiteId: s.uri.queryParameters['siteId'])),
      GoRoute(path: '/maintenance/:id', builder: (_, s) => MaintenanceDetailScreen(id: s.pathParameters['id']!)),

      // Carburant
      GoRoute(path: '/carburant', builder: (_, __) => const DepotageListScreen()),
      GoRoute(path: '/carburant/nouveau', builder: (_, s) => DepotageFormScreen(initialSiteId: s.uri.queryParameters['siteId'])),
      GoRoute(path: '/carburant/bon-livraison/nouveau', builder: (_, __) => const BlFormScreen()),

      // Énergie
      GoRoute(path: '/energie', builder: (_, __) => const ReleveListScreen()),
      GoRoute(path: '/energie/nouveau', builder: (_, s) => ReleveFormScreen(initialSiteId: s.uri.queryParameters['siteId'])),

      // Incidents (nouveau avant :id)
      GoRoute(path: '/incidents', builder: (_, __) => const IncidentsListScreen()),
      GoRoute(path: '/incidents/nouveau', builder: (_, s) => IncidentFormScreen(initialSiteId: s.uri.queryParameters['siteId'])),
      GoRoute(path: '/incidents/:id', builder: (_, s) => IncidentDetailScreen(id: s.pathParameters['id']!)),
    ],
  );
}

/// Adapte un Stream (BLoC) en Listenable pour rafraîchir GoRouter.
class _GoRouterRefreshStream extends ChangeNotifier {
  late final StreamSubscription<dynamic> _sub;
  _GoRouterRefreshStream(Stream<dynamic> stream) {
    notifyListeners();
    _sub = stream.asBroadcastStream().listen((_) => notifyListeners());
  }

  @override
  void dispose() {
    _sub.cancel();
    super.dispose();
  }
}
