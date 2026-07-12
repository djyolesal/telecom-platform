#!/bin/bash
# infra/scripts/restore.sh
# Restaure une sauvegarde dans la base (db_*.sql.gz) et, si fourni, les fichiers
# MinIO (minio_*.tar.gz). ⚠️  Écrase les données existantes.
# Usage : bash infra/scripts/restore.sh [db_backup.sql.gz] [minio_backup.tar.gz]

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
MINIO_FILE="${2:-}"
if [ -z "$FILE" ]; then
  echo "--- Sauvegardes disponibles dans $BACKUP_DIR ---"
  ls -lh "$BACKUP_DIR"/db_*.sql.gz 2>/dev/null || { echo "Aucune sauvegarde trouvée."; exit 1; }
  read -r -p "Chemin du dump base à restaurer : " FILE
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

# ON_ERROR_STOP=1 : le dump --clean/--if-exists se rejoue proprement ; toute
# vraie erreur ARRÊTE la restauration au lieu de produire une base incohérente.
echo "--- Restauration base ---"
gunzip -c "$FILE" | $COMPOSE exec -T postgres psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER}" "${POSTGRES_DB}"
echo "✅ Base restaurée depuis : $FILE"

# ── MinIO (fichiers) ─────────────────────────────────────────────────────
if [ -n "$MINIO_FILE" ] && [ -f "$MINIO_FILE" ]; then
  MINIO_VOLUME="${MINIO_VOLUME:-$(basename "$PWD")_minio_data}"
  read -r -p "⚠️  Restaurer aussi les fichiers MinIO dans '$MINIO_VOLUME' (écrase les fichiers actuels) ? [oui/NON] " C2
  if [ "$C2" = "oui" ]; then
    $COMPOSE stop minio || true
    docker run --rm -v "${MINIO_VOLUME}:/data" -v "$(cd "$(dirname "$MINIO_FILE")" && pwd):/backup:ro" alpine \
      sh -c "rm -rf /data/* && tar xzf /backup/$(basename "$MINIO_FILE") -C /data"
    $COMPOSE start minio || true
    echo "✅ Fichiers MinIO restaurés depuis : $MINIO_FILE"
  fi
fi

echo "✅ Restauration terminée."
