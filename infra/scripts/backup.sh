#!/bin/bash
# infra/scripts/backup.sh
# Backup manuel de la base PostgreSQL (pg_dump compressé) + rétention 30 jours.
# Usage : bash infra/scripts/backup.sh   (à lancer depuis la racine du projet)

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/telecom/backups}"
COMPOSE="${COMPOSE:-docker compose}"

# Charger les variables (.env) si présentes
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

mkdir -p "$BACKUP_DIR"
DATE=$(date +%Y%m%d_%H%M%S)
OUT="$BACKUP_DIR/backup_${DATE}.sql.gz"

echo "--- Backup PostgreSQL → $OUT ---"
$COMPOSE exec -T postgres pg_dump -U "${POSTGRES_USER}" "${POSTGRES_DB}" --no-owner --no-privileges \
  | gzip > "$OUT"

echo "✅ Backup créé : $OUT ($(du -h "$OUT" | cut -f1))"

echo "--- Nettoyage des backups de plus de 30 jours ---"
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +30 -delete -print

echo "✅ Terminé."
