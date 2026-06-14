#!/bin/bash
# infra/scripts/restore.sh
# Restaure un backup PostgreSQL (.sql.gz) dans la base.
# Usage : bash infra/scripts/restore.sh [chemin_du_backup.sql.gz]
# ⚠️  Écrase les données existantes — à utiliser avec précaution.

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/telecom/backups}"
COMPOSE="${COMPOSE:-docker compose}"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

FILE="${1:-}"
if [ -z "$FILE" ]; then
  echo "--- Backups disponibles dans $BACKUP_DIR ---"
  ls -lh "$BACKUP_DIR"/*.sql.gz 2>/dev/null || { echo "Aucun backup trouvé."; exit 1; }
  read -r -p "Chemin du fichier à restaurer : " FILE
fi

if [ ! -f "$FILE" ]; then
  echo "❌ Fichier introuvable : $FILE"
  exit 1
fi

read -r -p "⚠️  Confirmer la restauration de '$FILE' (les données actuelles seront écrasées) ? [oui/NON] " CONFIRM
if [ "$CONFIRM" != "oui" ]; then
  echo "Annulé."
  exit 0
fi

echo "--- Restauration en cours ---"
gunzip -c "$FILE" | $COMPOSE exec -T postgres psql -U "${POSTGRES_USER}" "${POSTGRES_DB}"

echo "✅ Restauration terminée depuis : $FILE"
