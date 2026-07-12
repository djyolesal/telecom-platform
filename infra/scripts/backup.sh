#!/bin/bash
# infra/scripts/backup.sh
# Sauvegarde COMPLÈTE : PostgreSQL (schéma+données) ET MinIO (photos, signatures,
# PDF, bons de livraison) — les deux sont indispensables pour reconstruire.
# Copie hors-site optionnelle si BACKUP_REMOTE est défini. Rétention 30 jours.
# Usage : bash infra/scripts/backup.sh   (depuis la racine du projet)

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/telecom/backups}"
COMPOSE="${COMPOSE:-docker compose}"
# Destination hors-site (rsync ou rclone). Ex : BACKUP_REMOTE="user@sauvegarde:/backups/telecom"
# ou un remote rclone "gdrive:telecom". Laisser vide pour désactiver.
BACKUP_REMOTE="${BACKUP_REMOTE:-}"

# Charger les variables (.env) si présentes
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

mkdir -p "$BACKUP_DIR"
DATE=$(date +%Y%m%d_%H%M%S)
DB_OUT="$BACKUP_DIR/db_${DATE}.sql.gz"
MINIO_OUT="$BACKUP_DIR/minio_${DATE}.tar.gz"

# ── 1. PostgreSQL ────────────────────────────────────────────────────────
# --clean --if-exists : le dump se restaure sur une base NON vide sans cascade
# d'erreurs « already exists » (restauration fiable, cf. restore.sh).
echo "--- Backup PostgreSQL → $DB_OUT ---"
$COMPOSE exec -T postgres pg_dump -U "${POSTGRES_USER}" "${POSTGRES_DB}" \
  --no-owner --no-privileges --clean --if-exists \
  | gzip > "$DB_OUT"
echo "✅ Base : $DB_OUT ($(du -h "$DB_OUT" | cut -f1))"

# ── 2. MinIO (fichiers) ──────────────────────────────────────────────────
# Archive le volume de données MinIO via un conteneur jetable monté dessus.
echo "--- Backup MinIO (fichiers) → $MINIO_OUT ---"
MINIO_VOLUME="${MINIO_VOLUME:-$(basename "$PWD")_minio_data}"
if docker volume inspect "$MINIO_VOLUME" >/dev/null 2>&1; then
  docker run --rm -v "${MINIO_VOLUME}:/data:ro" -v "${BACKUP_DIR}:/backup" alpine \
    tar czf "/backup/minio_${DATE}.tar.gz" -C /data .
  echo "✅ Fichiers : $MINIO_OUT ($(du -h "$MINIO_OUT" | cut -f1))"
else
  echo "⚠️  Volume MinIO '$MINIO_VOLUME' introuvable — définissez MINIO_VOLUME. Fichiers NON sauvegardés."
fi

# ── 3. Copie hors-site ───────────────────────────────────────────────────
# CRITIQUE : sans copie distante, un incident matériel emporte la base ET ses
# sauvegardes en même temps.
if [ -n "$BACKUP_REMOTE" ]; then
  echo "--- Copie hors-site → $BACKUP_REMOTE ---"
  if command -v rclone >/dev/null 2>&1 && [[ "$BACKUP_REMOTE" == *:* && "$BACKUP_REMOTE" != *@* ]]; then
    rclone copy "$DB_OUT" "$BACKUP_REMOTE"
    [ -f "$MINIO_OUT" ] && rclone copy "$MINIO_OUT" "$BACKUP_REMOTE" || true
  else
    rsync -az "$DB_OUT" "$BACKUP_REMOTE"/
    [ -f "$MINIO_OUT" ] && rsync -az "$MINIO_OUT" "$BACKUP_REMOTE"/ || true
  fi
  echo "✅ Copie hors-site effectuée."
else
  echo "⚠️  BACKUP_REMOTE non défini — sauvegardes uniquement locales (risque : panne disque = tout perdu)."
fi

# ── 4. Rétention locale (30 jours) ───────────────────────────────────────
echo "--- Nettoyage local (> 30 jours) ---"
find "$BACKUP_DIR" -name "db_*.sql.gz" -mtime +30 -delete -print
find "$BACKUP_DIR" -name "minio_*.tar.gz" -mtime +30 -delete -print

echo "✅ Sauvegarde terminée."
