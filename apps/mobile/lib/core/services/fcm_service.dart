import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:logger/logger.dart';
import '../../features/auth/data/auth_repository.dart';

/// Handler des messages reçus en arrière-plan (doit être top-level).
@pragma('vm:entry-point')
Future<void> firebaseBackgroundHandler(RemoteMessage message) async {
  // Le système affiche la notification ; rien de spécial à faire ici.
}

/// Gère les notifications push (FCM) et les notifications locales.
class FcmService {
  final AuthRepository _authRepo;
  final _local = FlutterLocalNotificationsPlugin();
  final _logger = Logger(printer: PrettyPrinter(methodCount: 0));

  static const _channel = AndroidNotificationChannel(
    'telecom_alerts',
    'Alertes E&M OpS',
    description: 'Incidents, alertes carburant et tâches assignées',
    importance: Importance.high,
  );

  FcmService(this._authRepo);

  /// Initialise FCM + notifications locales. Tolérant aux pannes (Firebase non configuré).
  Future<void> init() async {
    try {
      await _initLocal();

      final messaging = FirebaseMessaging.instance;
      await messaging.requestPermission(alert: true, badge: true, sound: true);

      final token = await messaging.getToken();
      if (token != null) await _authRepo.updateFcmToken(token);
      messaging.onTokenRefresh.listen(_authRepo.updateFcmToken);

      FirebaseMessaging.onMessage.listen(_onForegroundMessage);
      _logger.i('[FCM] initialisé');
    } catch (e) {
      _logger.w('[FCM] non initialisé (Firebase absent ?) : $e');
    }
  }

  Future<void> _initLocal() async {
    const android = AndroidInitializationSettings('@mipmap/ic_launcher');
    const ios = DarwinInitializationSettings();
    await _local.initialize(const InitializationSettings(android: android, iOS: ios));
    await _local
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(_channel);
  }

  void _onForegroundMessage(RemoteMessage message) {
    final n = message.notification;
    if (n == null) return;
    _local.show(
      n.hashCode,
      n.title,
      n.body,
      NotificationDetails(
        android: AndroidNotificationDetails(
          _channel.id,
          _channel.name,
          channelDescription: _channel.description,
          importance: Importance.high,
          priority: Priority.high,
        ),
        iOS: const DarwinNotificationDetails(),
      ),
    );
  }
}
