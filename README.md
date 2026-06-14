# 📡 Plateforme Télécom & Énergie — v3.0

Plateforme complète de gestion d'un parc de sites BTS/antennes pour opérateur télécom.
**Architecture serveur unique tout-en-un** via Docker Compose.

---

## 🏗️ Architecture

```
Serveur Ubuntu 22.04 LTS (1 machine)
│
├── Nginx :443          → Reverse proxy SSL
├── Next.js :3000       → Portail web supervision/admin
├── Node.js API :3001   → REST API + WebSocket
├── PostgreSQL :5432    → Base de données principale + TimescaleDB
├── Redis :6379         → Cache + sessions + queues
├── MinIO :9000         → Stockage photos, PDF, documents
├── Prometheus :9090    → Métriques
└── Grafana :3003       → Dashboards monitoring
```

## 📱 Applications

| Application | Technologie | Utilisateurs |
|-------------|-------------|--------------|
| Mobile iOS/Android | Flutter 3.22 | Techniciens terrain |
| Portail Web | Next.js 14 | Superviseurs, Managers, Admins |
| API Backend | Node.js 20 + Express | (Backend) |

---

## 🚀 Installation rapide (serveur)

### Prérequis
- Ubuntu 22.04 LTS **ou** Debian 12 (Bookworm) — le script d'install détecte la distribution
- Domaine DNS pointant vers le serveur
- Accès root SSH

### 1. Préparer le serveur
```bash
sudo bash infra/scripts/setup-server.sh
```

### 2. Cloner le projet
```bash
su - deploy
cd /opt/telecom/app
git clone <votre-repo> .
```

### 3. Obtenir le certificat SSL
```bash
sudo certbot certonly --nginx -d votre-domaine.tg
sudo cp /etc/letsencrypt/live/votre-domaine.tg/{fullchain.pem,privkey.pem} /opt/telecom/ssl/
```

### 4. Configurer les variables d'environnement
```bash
cp .env.example .env
nano .env          # ⚠️ Remplir TOUTES les valeurs obligatoirement
```

### 5. Lancer l'installation
```bash
make install       # Build images + migrations + seed + démarrage
```

### 6. Vérifier
```bash
make status        # État des 8 conteneurs
```

L'application est accessible sur `https://votre-domaine.tg`

---

## 🛠️ Commandes de gestion

```bash
make start         # Démarrer
make stop          # Arrêter
make restart       # Redémarrer
make status        # État + ressources
make logs          # Logs temps réel
make logs-api      # Logs API
make backup        # Backup BDD
make restore       # Restaurer backup
make update        # Mise à jour (git pull + rebuild)
make migrate       # Appliquer migrations Prisma
make ssl           # Renouveler SSL
```

---

## 📱 Application mobile (Flutter)

Application terrain offline-first (Clean Architecture + BLoC, cache Drift + outbox de
synchronisation, biométrie, FCM). Voir [apps/mobile/README.md](apps/mobile/README.md).

```bash
cd apps/mobile
flutter create --platforms=android,ios .          # dossiers de plateforme
flutter pub get
dart run build_runner build --delete-conflicting-outputs   # code Drift
flutter run --dart-define=API_URL=https://votre-domaine.tg/api/v1
```

---

## 🔗 URLs du portail

| URL | Accès |
|-----|-------|
| `https://votre-domaine.tg` | Portail web principal |
| `https://votre-domaine.tg/api/docs` | Documentation API Swagger |
| `https://votre-domaine.tg/grafana` | Monitoring Grafana (admin) |
| `https://votre-domaine.tg/minio` | MinIO console (admin) |

---

## 📁 Structure du projet

```
telecom-platform/
├── apps/
│   ├── mobile/          # Flutter app (iOS + Android)
│   ├── web/             # Next.js portail web
│   └── api/             # Node.js API REST + WebSocket
├── infra/
│   ├── nginx/           # Config reverse proxy
│   ├── prometheus/      # Config monitoring
│   ├── grafana/         # Dashboards JSON
│   └── scripts/         # Scripts installation + backup
├── docker-compose.yml   # Orchestration complète
├── .env.example         # Template variables d'env
└── Makefile             # Commandes de gestion
```

---

## 👥 Rôles utilisateurs

| Rôle | Accès Mobile | Accès Web |
|------|-------------|-----------|
| TECHNICIEN | ✅ Saisie complète | ❌ |
| SUPERVISEUR | ✅ + Assignation | ✅ Supervision + Rapports |
| MANAGER | ✅ Lecture | ✅ Tout sauf Admin |
| ADMIN | ❌ | ✅ Tout + Système |
| DIRECTION | ❌ | ✅ Lecture seule |

---

## 🔐 Sécurité

- JWT access (15 min) + refresh token rotatif (30 j)
- HTTPS forcé via Nginx (TLS 1.2/1.3)
- Rate limiting par IP (Nginx + Redis)
- RBAC sur chaque endpoint API
- Audit log de toutes les actions sensibles
- Backup quotidien automatique (3h du matin)
- Fail2ban protection SSH

---

## ⚙️ Spécifications serveur recommandées

| Composant | Minimum | Recommandé |
|-----------|---------|------------|
| CPU | 8 vCPU | 16 vCPU |
| RAM | 16 GB | 32 GB |
| Disque OS | 100 GB SSD | 200 GB SSD |
| Disque Data | 500 GB | 1 TB SSD |
| Réseau | 100 Mbps | 1 Gbps |

---

*Version 3.0 — Juin 2026 — Opérateur télécom Afrique de l'Ouest*
