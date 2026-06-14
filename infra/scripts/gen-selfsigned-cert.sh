#!/bin/bash
# =============================================================
# gen-selfsigned-cert.sh — Certificat TLS auto-signé pour une IP (ou un domaine)
# Usage : bash infra/scripts/gen-selfsigned-cert.sh <IP_OU_DOMAINE> [jours]
# Exemple : bash infra/scripts/gen-selfsigned-cert.sh 203.0.113.10
# Place fullchain.pem + privkey.pem dans infra/ssl/ (monté par Nginx).
# =============================================================
set -e

HOST="${1:-}"
DAYS="${2:-825}"   # 825 j = max accepté par la plupart des navigateurs

if [ -z "$HOST" ]; then
  echo "Usage : bash $0 <IP_OU_DOMAINE> [jours]"
  exit 1
fi

# Dossier de sortie : infra/ssl à la racine du projet
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SSL_DIR="$SCRIPT_DIR/../ssl"
mkdir -p "$SSL_DIR"

# Détecte si HOST est une IP ou un domaine → SAN approprié
if echo "$HOST" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
  SAN="IP:$HOST"
else
  SAN="DNS:$HOST"
fi

echo "→ Génération d'un certificat auto-signé pour $HOST (SAN: $SAN, $DAYS jours)…"

openssl req -x509 -nodes -newkey rsa:2048 \
  -keyout "$SSL_DIR/privkey.pem" \
  -out "$SSL_DIR/fullchain.pem" \
  -days "$DAYS" \
  -subj "/C=TG/O=TelecomOps/CN=$HOST" \
  -addext "subjectAltName=$SAN"

chmod 600 "$SSL_DIR/privkey.pem"
chmod 644 "$SSL_DIR/fullchain.pem"

echo "✅ Certificat généré :"
echo "   $SSL_DIR/fullchain.pem"
echo "   $SSL_DIR/privkey.pem"
echo ""
echo "Redémarrez Nginx pour l'appliquer : docker compose restart nginx"
