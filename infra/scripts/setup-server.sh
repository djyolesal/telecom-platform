#!/bin/bash
# =============================================================
# setup-server.sh — Installation serveur Ubuntu 22.04 LTS / Debian 12
# Usage : sudo bash infra/scripts/setup-server.sh
# =============================================================
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║    Installation Plateforme Télécom                   ║"
echo "║    Ubuntu 22.04 / Debian 12 — Serveur tout-en-un     ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

[[ $EUID -ne 0 ]] && err "Ce script doit être exécuté en root (sudo)"

# ── Détection de la distribution (Ubuntu ou Debian) ───────────
. /etc/os-release
case "$ID" in
  ubuntu) DOCKER_REPO=ubuntu ;;
  debian) DOCKER_REPO=debian ;;
  *)
    # Dérivés : se rabattre sur la base déclarée dans ID_LIKE
    if echo "${ID_LIKE:-}" | grep -qw ubuntu; then DOCKER_REPO=ubuntu
    elif echo "${ID_LIKE:-}" | grep -qw debian; then DOCKER_REPO=debian
    else err "Distribution non supportée ($ID). Utilisez Ubuntu ou Debian."; fi ;;
esac
log "Distribution détectée : ${PRETTY_NAME:-$ID} → dépôt Docker '$DOCKER_REPO'"

# ── 1. Mise à jour système ────────────────────────────────────
log "Mise à jour système..."
apt-get update -qq && apt-get upgrade -y -qq

# ── 2. Dépendances ────────────────────────────────────────────
log "Installation des dépendances..."
apt-get install -y -qq \
  curl wget git unzip jq \
  ca-certificates gnupg lsb-release \
  ufw fail2ban \
  certbot python3-certbot-nginx \
  htop ncdu tree \
  postgresql-client

# ── 3. Docker ─────────────────────────────────────────────────
log "Installation de Docker..."
if ! command -v docker &>/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${DOCKER_REPO}/gpg" \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/${DOCKER_REPO} $(lsb_release -cs) stable" \
    | tee /etc/apt/sources.list.d/docker.list > /dev/null
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi
systemctl enable --now docker
log "Docker $(docker --version | cut -d' ' -f3 | tr -d ',')"

# ── 4. Utilisateur deploy ─────────────────────────────────────
log "Création de l'utilisateur deploy..."
useradd -m -s /bin/bash deploy 2>/dev/null || true
usermod -aG docker deploy
log "Utilisateur 'deploy' configuré"

# ── 5. Firewall UFW ───────────────────────────────────────────
log "Configuration du firewall..."
ufw default deny incoming -q
ufw default allow outgoing -q
ufw allow ssh -q
ufw allow 80/tcp -q
ufw allow 443/tcp -q
# NE PAS exposer les ports internes Docker (PostgreSQL 5432, Redis 6379, etc.)
ufw --force enable -q
log "Firewall activé (SSH + 80 + 443)"

# ── 6. Fail2ban ───────────────────────────────────────────────
log "Configuration Fail2ban..."
cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true
port = ssh
logpath = %(sshd_log)s
EOF
systemctl enable --now fail2ban -q

# ── 7. Répertoires de données ─────────────────────────────────
log "Création des répertoires de données..."
mkdir -p /opt/telecom/data/{postgres,redis,minio,grafana,prometheus}
mkdir -p /opt/telecom/{logs,backups,ssl,app}
chown -R deploy:deploy /opt/telecom
chmod -R 755 /opt/telecom
chmod 700 /opt/telecom/backups
log "Répertoires créés dans /opt/telecom/"

# ── 8. Swap (si RAM < 16GB) ───────────────────────────────────
RAM_GB=$(free -g | awk '/^Mem:/{print $2}')
if [ "$RAM_GB" -lt 16 ]; then
  warn "RAM détectée : ${RAM_GB}GB < 16GB — Création d'un swap de 4GB..."
  if [ ! -f /swapfile ]; then
    fallocate -l 4G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile -q
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    log "Swap 4GB activé"
  fi
fi

# ── 9. Optimisations kernel ───────────────────────────────────
log "Optimisations kernel (PostgreSQL + Redis)..."
cat >> /etc/sysctl.conf << 'EOF'
# Télécom Platform optimizations
vm.swappiness=10
vm.overcommit_memory=1
net.core.somaxconn=65535
net.ipv4.tcp_max_syn_backlog=65535
net.ipv4.tcp_fin_timeout=15
EOF
sysctl -p -q

# ── 10. Cron automatiques ─────────────────────────────────────
log "Configuration des cron jobs système..."
cat >> /etc/crontab << 'EOF'
# Backup BDD tous les jours à 3h
0 3 * * * deploy cd /opt/telecom/app && make backup >> /opt/telecom/logs/backup.log 2>&1

# Renouvellement SSL (1er et 15 du mois)
0 0 1,15 * * root certbot renew --quiet && docker compose -f /opt/telecom/app/docker-compose.yml restart nginx >> /opt/telecom/logs/ssl.log 2>&1
EOF

# ── 11. Alias utiles ──────────────────────────────────────────
cat >> /home/deploy/.bashrc << 'EOF'
# Télécom Platform aliases
alias telecom='cd /opt/telecom/app'
alias tlogs='cd /opt/telecom/app && make logs'
alias tstatus='cd /opt/telecom/app && make status'
alias tbackup='cd /opt/telecom/app && make backup'
EOF

echo ""
log "Installation terminée !"
echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Prochaines étapes :"
echo ""
echo "  1. Cloner le projet :"
echo "     su - deploy"
echo "     cd /opt/telecom/app"
echo "     git clone <votre-repo> ."
echo ""
echo "  2. Obtenir certificat SSL :"
echo "     certbot certonly --nginx -d votre-domaine.tg"
echo "     cp /etc/letsencrypt/live/votre-domaine.tg/* /opt/telecom/ssl/"
echo ""
echo "  3. Configurer l'environnement :"
echo "     cp .env.example .env"
echo "     nano .env  # Remplir TOUTES les valeurs"
echo ""
echo "  4. Lancer l'installation :"
echo "     make install"
echo ""
echo "═══════════════════════════════════════════════════════"
