# 📱 TélécomOps — Application mobile (Flutter)

Application terrain pour les techniciens : saisie maintenance, dépotage, relevés
énergie et incidents, **avec fonctionnement hors-ligne** et synchronisation automatique.

## Architecture

**Clean Architecture + BLoC (Cubit)**, offline-first.

```
lib/
├── main.dart                 # Bootstrap (Hive, Firebase, DI)
├── app.dart                  # MaterialApp.router + providers
├── injection.dart            # Service locator (DI)
├── core/
│   ├── constants/            # Constantes, énumérations métier
│   ├── theme/                # Thème (couleurs alignées au portail web)
│   ├── errors/               # Exceptions & failures
│   ├── network/              # DioClient + intercepteurs (auth/refresh/retry)
│   ├── storage/              # SecureStorage (jetons, session)
│   ├── database/             # Drift : cache sites + outbox offline
│   ├── sync/                 # SyncService (rejoue les écritures hors-ligne)
│   ├── services/             # Localisation, upload, FCM
│   ├── router/               # GoRouter + garde d'auth
│   ├── bloc/                 # ListCubit générique
│   ├── utils/                # Formatters
│   └── widgets/              # Composants partagés (signature, picker, états)
└── features/
    ├── auth/                 # Login + biométrie + refresh token
    ├── dashboard/            # Accueil + KPIs + raccourcis
    ├── sites/                # Liste + fiche (cache offline)
    ├── maintenance/          # Liste, planification, démarrage/clôture + signature
    ├── carburant/            # Dépotages (liste + saisie)
    ├── energie/              # Relevés (liste + saisie)
    └── incidents/            # Liste, déclaration, clôture
```

## Fonctionnement offline-first

- **Lecture** : les sites sont mis en cache (Drift) et restent consultables hors-ligne.
- **Écriture** : toute saisie hors-ligne est placée dans une **outbox** (table Drift)
  et rejouée automatiquement par le `SyncService` à la reconnexion
  (écoute `connectivity_plus`). Une bannière indique le nombre d'opérations en attente.
- **Auth** : jetons stockés dans le Keychain/Keystore (`flutter_secure_storage`),
  refresh automatique sur 401, déverrouillage **biométrique** optionnel.

## Mise en route

> ⚠️ Flutter génère les dossiers de plateforme et le code Drift — ces étapes sont
> obligatoires avant la première compilation.

```bash
cd apps/mobile

# 1. Générer les dossiers Android/iOS (ne touche pas à lib/)
flutter create --platforms=android,ios .

# 2. Dépendances
flutter pub get

# 3. Génération du code Drift (app_database.g.dart)
dart run build_runner build --delete-conflicting-outputs

# 4. Lancer (en pointant vers l'API)
flutter run --dart-define=API_URL=https://telecom.votredomaine.tg/api/v1
```

### Build release

```bash
# Android (APK signé : configurer android/key.properties au préalable)
flutter build apk --release --dart-define=API_URL=https://telecom.votredomaine.tg/api/v1

# iOS (archive Xcode)
flutter build ipa --release --dart-define=API_URL=https://telecom.votredomaine.tg/api/v1
```

## Firebase Cloud Messaging (push)

Les notifications sont **optionnelles** : l'app démarre même sans Firebase configuré.
Pour les activer :

1. Créer un projet Firebase et ajouter les apps Android/iOS.
2. Déposer `android/app/google-services.json` et `ios/Runner/GoogleService-Info.plist`.
3. (Recommandé) `flutterfire configure` pour générer `firebase_options.dart`,
   puis passer les options à `Firebase.initializeApp(options: ...)` dans `main.dart`.

Le jeton FCM est envoyé à l'API via `POST /auth/fcm-token` après connexion.

## Permissions à déclarer

- **Android** (`android/app/src/main/AndroidManifest.xml`) :
  `INTERNET`, `ACCESS_FINE_LOCATION`, `USE_BIOMETRIC`, `CAMERA`, `POST_NOTIFICATIONS`.
- **iOS** (`ios/Runner/Info.plist`) :
  `NSLocationWhenInUseUsageDescription`, `NSFaceIDUsageDescription`, `NSCameraUsageDescription`.

## Comptes de test (seed API)

`technicien1@telecom.tg` / `Telecom@2026`
