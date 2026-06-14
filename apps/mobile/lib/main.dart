import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'app.dart';
import 'core/constants/app_constants.dart';
import 'core/services/fcm_service.dart';
import 'injection.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Données de localisation pour le formatage des dates (fr).
  await initializeDateFormatting('fr_FR', null);

  // Cache rapide Hive (paramètres légers).
  await Hive.initFlutter();
  await Hive.openBox(AppConstants.kSettingsBox);

  // Firebase / FCM — tolérant si la config plateforme est absente.
  try {
    await Firebase.initializeApp();
    FirebaseMessaging.onBackgroundMessage(firebaseBackgroundHandler);
  } catch (_) {
    // Firebase non configuré (google-services.json / GoogleService-Info.plist) : on continue.
  }

  final di = Injection();
  await di.init();

  runApp(TelecomApp(di: di));
}
