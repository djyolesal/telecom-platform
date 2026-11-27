#!/bin/bash
# infra/scripts/restaurer-fichiers.sh
# Remet dans MinIO des fichiers PRÉCIS (une clé par ligne) en les cherchant dans
# les sauvegardes minio_*.tar.gz. N'écrase jamais un objet présent.
#
# Contexte : de août à novembre 2026, la purge nocturne effaçait les fichiers
# de colonnes qu'elle ne connaissait pas (certificats de jaugeage, pièces des
# mouvements, bons de retour...). DÉPLOYER LE CORRECTIF AVANT, sinon les
# fichiers restaurés repartent à la purge suivante (4 h 30).
#
# Usage (depuis la racine du projet) :
#   docker compose run --rm --no-deps -T api node dist/scripts/fichiersManquants.js --cles > cles.txt
#   bash infra/scripts/restaurer-fichiers.sh cles.txt              # essai : cherche, ne copie rien
#   bash infra/scripts/restaurer-fichiers.sh cles.txt --appliquer  # copie dans le volume MinIO
#
# MinIO tourne en mode « xl-single » : un objet est le dossier
# <bucket>/<clé>/ (xl.meta + données). On extrait ces dossiers des archives,
# puis on les copie dans le volume sans écraser l'existant (cp -n).

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/telecom/backups}"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi
MINIO_BUCKET="${MINIO_BUCKET:-telecom-files}"
MINIO_VOLUME="${MINIO_VOLUME:-$(basename "$PWD")_minio_data}"

CLES="${1:-}"
APPLIQUER="${2:-}"
if [ -z "$CLES" ] || [ ! -s "$CLES" ]; then
  echo "Usage : bash infra/scripts/restaurer-fichiers.sh cles.txt [--appliquer]"
  exit 1
fi
docker volume inspect "$MINIO_VOLUME" >/dev/null 2>&1 || { echo "❌ Volume MinIO '$MINIO_VOLUME' introuvable (définir MINIO_VOLUME)."; exit 1; }

STAGING="$(mktemp -d /tmp/restaurer-fichiers.XXXXXX)"
RESTE="$STAGING/reste.txt"
# Clés « propres » seulement : pas de traversée de chemin.
grep -E '^[A-Za-z0-9._/-]+$' "$CLES" | grep -v '\.\.' | sort -u > "$RESTE" || true
TOTAL=$(wc -l < "$RESTE")
echo "--- $TOTAL clé(s) à retrouver, bucket $MINIO_BUCKET ---"

# Archives de la plus récente à la plus ancienne.
mapfile -t ARCHIVES < <(ls -1t "$BACKUP_DIR"/minio_*.tar.gz 2>/dev/null || true)
[ "${#ARCHIVES[@]}" -gt 0 ] || { echo "❌ Aucune archive minio_*.tar.gz dans $BACKUP_DIR."; exit 1; }

EXTRAIT="$STAGING/data"
mkdir -p "$EXTRAIT"
for ARCHIVE in "${ARCHIVES[@]}"; do
  [ -s "$RESTE" ] || break
  sed "s|^|./${MINIO_BUCKET}/|" "$RESTE" > "$STAGING/membres.txt"
  # Les clés absentes de cette archive font sortir tar en erreur : attendu.
  tar xzf "$ARCHIVE" -C "$EXTRAIT" -T "$STAGING/membres.txt" 2>/dev/null || true
  : > "$STAGING/reste2.txt"
  TROUVES=0
  while IFS= read -r CLE; do
    if [ -f "$EXTRAIT/$MINIO_BUCKET/$CLE/xl.meta" ]; then TROUVES=$((TROUVES + 1)); else echo "$CLE" >> "$STAGING/reste2.txt"; fi
  done < "$RESTE"
  mv "$STAGING/reste2.txt" "$RESTE"
  echo "  $(basename "$ARCHIVE") : $TROUVES retrouvée(s), $(wc -l < "$RESTE") restante(s)"
done

RETROUVES=$((TOTAL - $(wc -l < "$RESTE")))
echo "--- $RETROUVES / $TOTAL retrouvée(s) dans les sauvegardes ---"
if [ -s "$RESTE" ]; then
  cp "$RESTE" ./cles-introuvables.txt
  echo "⚠️  $(wc -l < "$RESTE") clé(s) dans aucune sauvegarde : liste dans cles-introuvables.txt"
fi

if [ "$APPLIQUER" != "--appliquer" ]; then
  echo "Essai seulement : rien n'a été copié. Relancer avec --appliquer pour restaurer."
  echo "(fichiers extraits dans $STAGING, supprimables ensuite)"
  exit 0
fi
[ "$RETROUVES" -gt 0 ] || { echo "Rien à copier."; rm -rf "$STAGING"; exit 0; }

echo "--- Copie dans le volume $MINIO_VOLUME (sans écraser) ---"
docker run --rm -v "${MINIO_VOLUME}:/data" -v "${EXTRAIT}:/restore:ro" alpine \
  sh -c "cp -Rn /restore/${MINIO_BUCKET}/. /data/${MINIO_BUCKET}/"
rm -rf "$STAGING"
echo "✅ $RETROUVES fichier(s) restauré(s). Vérifier : relancer fichiersManquants.js (le total doit baisser d'autant)."
