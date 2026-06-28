import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'core/router/app_router.dart';
import 'core/theme/app_theme.dart';
import 'features/auth/presentation/auth_cubit.dart';
import 'injection.dart';

class TelecomApp extends StatefulWidget {
  final Injection di;
  const TelecomApp({super.key, required this.di});

  @override
  State<TelecomApp> createState() => _TelecomAppState();
}

class _TelecomAppState extends State<TelecomApp> {
  late final AuthCubit _authCubit;
  late final GoRouter _router;

  @override
  void initState() {
    super.initState();
    _authCubit = AuthCubit(widget.di.authRepository)..bootstrap();
    // Déconnexion automatique si la session expire (refresh échoué)
    widget.di.onSessionExpired = () => _authCubit.logout();
    _router = createRouter(_authCubit);

    // Initialise les notifications push + charge la config terrain une fois l'app prête.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      widget.di.fcmService.init();
      widget.di.configService.load();
    });
  }

  @override
  void dispose() {
    _authCubit.close();
    widget.di.syncService.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final di = widget.di;
    return MultiRepositoryProvider(
      providers: [
        RepositoryProvider.value(value: di.siteRepository),
        RepositoryProvider.value(value: di.maintenanceRepository),
        RepositoryProvider.value(value: di.depotageRepository),
        RepositoryProvider.value(value: di.bonLivraisonRepository),
        RepositoryProvider.value(value: di.releveRepository),
        RepositoryProvider.value(value: di.incidentRepository),
        RepositoryProvider.value(value: di.dashboardRepository),
        RepositoryProvider.value(value: di.uploadService),
        RepositoryProvider.value(value: di.syncService),
        RepositoryProvider.value(value: di.configService),
      ],
      child: BlocProvider.value(
        value: _authCubit,
        child: MaterialApp.router(
          title: 'TélécomOps',
          debugShowCheckedModeBanner: false,
          theme: AppTheme.light,
          routerConfig: _router,
        ),
      ),
    );
  }
}
