#!/usr/bin/env bash
#
# Purge de mise en service — bascule du mode TEST vers l'exploitation réelle.
#
# La plateforme a tourné en test : les interventions, dépotages, coupures et
# incidents saisis pendant cette période ne doivent pas polluer les premiers
# rapports contractuels (SLA, disponibilité, conformité), ni les compteurs de
# référence (MNT-2026-00001 doit être la PREMIÈRE intervention réelle).
#
# Deux niveaux :
#   NIVEAU=exploitation (défaut) — vide l'ACTIVITÉ, conserve le RÉFÉRENTIEL
#       (sites + topologie, lots, prestataires, contacts, utilisateurs, GE et
#       actifs, paramètres système). C'est le cas normal : le parc est déjà
#       saisi et vérifié, seule l'activité de test est à effacer.
#   NIVEAU=total — vide AUSSI le référentiel, ne laisse que les paramètres
#       système et UN compte administrateur (ADMIN_EMAIL). À n'utiliser que si
#       le parc lui-même doit être ressaisi depuis zéro.
#
# Sécurités : confirmation explicite, sauvegarde complète préalable OBLIGATOIRE
# (la purge est annulée si elle échoue), tout le SQL dans une seule transaction.
#
# Usage (depuis /opt/telecom-platform sur le serveur) :
#   bash infra/scripts/purge-mise-en-service.sh
#   NIVEAU=total ADMIN_EMAIL=admin@emops.uk bash infra/scripts/purge-mise-en-service.sh
#
set -euo pipefail

NIVEAU="${NIVEAU:-exploitation}"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"

cd "$(dirname "$0")/../.."

if [ ! -f .env ]; then
  echo "❌ .env introuvable — lancez ce script depuis la racine du déploiement."
  exit 1
fi

lire_env() { grep -E "^$1=" .env | head -1 | cut -d= -f2- ; }
PG_USER="$(lire_env POSTGRES_USER)"
PG_DB="$(lire_env POSTGRES_DB)"
MINIO_USER="$(lire_env MINIO_ROOT_USER)"
MINIO_PASS="$(lire_env MINIO_ROOT_PASSWORD)"
REDIS_PASS="$(lire_env REDIS_PASSWORD)"

case "$NIVEAU" in
  exploitation|total) ;;
  *) echo "❌ NIVEAU doit valoir 'exploitation' ou 'total' (reçu : $NIVEAU)"; exit 1 ;;
esac

# L'email est interpolé dans du SQL : on ne tolère qu'un format d'adresse
# strict (pas d'apostrophe, d'espace ou de méta-caractère possible).
if [ -n "$ADMIN_EMAIL" ] && ! printf '%s' "$ADMIN_EMAIL" | grep -Eq '^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+$'; then
  echo "❌ ADMIN_EMAIL invalide : '$ADMIN_EMAIL'"
  exit 1
fi

if [ "$NIVEAU" = "total" ] && [ -z "$ADMIN_EMAIL" ]; then
  echo "❌ NIVEAU=total exige ADMIN_EMAIL=<email du compte admin à conserver>."
  echo "   Sans lui, la purge laisserait une plateforme sans aucun accès."
  exit 1
fi

echo "════════════════════════════════════════════════════════════════"
echo "  PURGE DE MISE EN SERVICE — niveau : $NIVEAU"
echo "════════════════════════════════════════════════════════════════"
echo
echo "SERONT EFFACÉES DÉFINITIVEMENT :"
echo "  · maintenances, pièces de rechange, photos"
echo "  · dépotages (+ heures GE), relevés énergie"
echo "  · incidents, coupures réseau"
echo "  · bons de commande / de livraison, plans de livraison"
echo "  · notifications, journal SMS, journal d'audit"
echo "  · compteurs de référence (MNT/INC/DEP repartent à 00001)"
echo "  · TOUS les fichiers du stockage (photos, signatures, PDF)"
echo "  · verrous d'appareil mobile et sessions en cours"
if [ "$NIVEAU" = "total" ]; then
echo "  · sites et topologie de transmission"
echo "  · groupes électrogènes et actifs (batteries, climatiseurs)"
echo "  · lots, affectations, prestataires, contacts"
echo "  · tous les utilisateurs SAUF $ADMIN_EMAIL"
fi
echo
echo "SERONT CONSERVÉS :"
if [ "$NIVEAU" = "exploitation" ]; then
echo "  · sites, topologie de transmission, lots, affectations"
echo "  · prestataires, contacts à notifier, utilisateurs"
echo "  · groupes électrogènes et actifs (identités, n° de série)"
fi
echo "  · paramètres système, référentiel des types de pylône"
echo "  · schéma et migrations (aucun DROP)"
echo
read -r -p "Tapez exactement 'PURGER' pour confirmer : " CONF
[ "$CONF" = "PURGER" ] || { echo "❌ Annulé."; exit 1; }

echo
echo "── [1/5] Sauvegarde complète préalable ──────────────────────"
bash infra/scripts/backup.sh || { echo "❌ Sauvegarde échouée — purge ANNULÉE."; exit 1; }

echo
echo "── [2/5] Arrêt de l'API (aucune écriture pendant la purge) ──"
# Sans cela, un cron (situation périodique, alertes) ou une remontée mobile
# peut réinsérer des lignes entre le TRUNCATE et la fin du script.
docker compose stop api

echo
echo "── [3/5] Purge de la base ───────────────────────────────────"
TMP_SQL="$(mktemp)"
trap 'rm -f "$TMP_SQL"' EXIT
cat > "$TMP_SQL" <<'SQL'
BEGIN;

-- Activité : tout ce qui décrit un événement d'exploitation.
TRUNCATE TABLE
  photos,
  pieces_rechange,
  depotage_heures_ge,
  depotages,
  releves_energie,
  maintenances,
  incidents,
  coupures_reseau,
  lignes_livraison,
  bons_livraison,
  volumes_mensuels,
  bons_commande,
  notifications,
  sms_logs,
  audit_logs,
  compteurs_reference
RESTART IDENTITY CASCADE;
SQL

# Fragment « exploitation » : compteurs d'usure et verrous d'appareil.
cat > "${TMP_SQL}.exploitation" <<'SQL'
-- Compteurs d'usure portés par l'ACTIF : sans remise à zéro, l'alerte de
-- vidange se déclencherait sur un index relevé pendant les tests, alors que
-- l'historique qui le justifiait vient d'être effacé.
UPDATE groupes_electrogenes
   SET index_heures_derniere_vidange = NULL,
       date_derniere_vidange = NULL;

-- Verrous d'appareil : les téléphones de test ne doivent pas rester liés aux
-- comptes terrain, sinon le vrai téléphone du technicien sera refusé.
UPDATE users
   SET appareil_id = NULL,
       appareil_label = NULL,
       appareil_lie_le = NULL,
       last_login_at = NULL;

COMMIT;
SQL

# Fragment « total » : référentiel complet (interpolé : $ADMIN_EMAIL).
cat > "${TMP_SQL}.total" <<SQL
-- Référentiel complet. L'ordre est sans importance (CASCADE), mais les
-- utilisateurs passent par un DELETE pour préserver le compte d'accès.
DELETE FROM users WHERE lower(email) <> lower('$ADMIN_EMAIL');
UPDATE users
   SET appareil_id = NULL, appareil_label = NULL,
       appareil_lie_le = NULL, last_login_at = NULL;

TRUNCATE TABLE
  groupes_electrogenes,
  equipements_actifs,
  sites,
  lot_assignments,
  lots,
  contacts,
  prestataires,
  taches_preventives_overrides
RESTART IDENTITY CASCADE;

COMMIT;
SQL

if [ "$NIVEAU" = "total" ]; then
  # Garde-fou : refuser la purge si l'email d'admin n'existe pas — sinon on
  # supprimerait le dernier accès à la plateforme.
  NB=$(docker compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -tAc \
    "SELECT count(*) FROM users WHERE lower(email) = lower('$ADMIN_EMAIL') AND role = 'ADMIN' AND is_active;" | tr -d '[:space:]')
  if [ "$NB" != "1" ]; then
    echo "❌ Aucun ADMIN actif avec l'email '$ADMIN_EMAIL' — purge ANNULÉE."
    docker compose start api
    exit 1
  fi
  cat "${TMP_SQL}.total" >> "$TMP_SQL"
else
  cat "${TMP_SQL}.exploitation" >> "$TMP_SQL"
fi
rm -f "${TMP_SQL}.exploitation" "${TMP_SQL}.total"

docker compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 < "$TMP_SQL"

echo
echo "── [4/5] Purge du stockage de fichiers et du cache ──────────"
# Objets MinIO : photos d'intervention, signatures, bordereaux et PDF de test.
# `mc` n'est pas garanti dans l'image du serveur selon la version — on retombe
# sur un conteneur client jetable branché sur le réseau du déploiement.
purger_minio() {
  if docker compose exec -T minio sh -c 'command -v mc' >/dev/null 2>&1; then
    docker compose exec -T minio sh -c \
      "mc alias set purge http://localhost:9000 '$MINIO_USER' '$MINIO_PASS' >/dev/null &&
       mc rm --recursive --force purge/telecom-files/ >/dev/null 2>&1;
       mc alias remove purge >/dev/null 2>&1; true"
    return 0
  fi
  local reseau
  reseau="$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' telecom_minio 2>/dev/null | head -1)"
  if [ -z "$reseau" ]; then
    echo "⚠️  Réseau MinIO introuvable — fichiers NON purgés (à faire manuellement)."
    return 0
  fi
  docker run --rm --network "$reseau" --entrypoint sh minio/mc -c \
    "mc alias set purge http://minio:9000 '$MINIO_USER' '$MINIO_PASS' >/dev/null &&
     mc rm --recursive --force purge/telecom-files/ >/dev/null 2>&1; true"
}
purger_minio

# Redis : sessions, jetons de rafraîchissement, clés d'idempotence et caches
# pointent tous vers des identifiants qui n'existent plus.
docker compose exec -T redis redis-cli -a "$REDIS_PASS" --no-auth-warning FLUSHALL >/dev/null

echo
echo "── [5/5] Redémarrage et vérification ────────────────────────"
docker compose start api
sleep 8

docker compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -c "
SELECT 'sites' AS table, count(*) FROM sites
UNION ALL SELECT 'utilisateurs', count(*) FROM users
UNION ALL SELECT 'prestataires', count(*) FROM prestataires
UNION ALL SELECT 'groupes_electrogenes', count(*) FROM groupes_electrogenes
UNION ALL SELECT 'maintenances', count(*) FROM maintenances
UNION ALL SELECT 'depotages', count(*) FROM depotages
UNION ALL SELECT 'incidents', count(*) FROM incidents
UNION ALL SELECT 'coupures_reseau', count(*) FROM coupures_reseau
UNION ALL SELECT 'releves_energie', count(*) FROM releves_energie
UNION ALL SELECT 'photos', count(*) FROM photos
UNION ALL SELECT 'sms_logs', count(*) FROM sms_logs
UNION ALL SELECT 'audit_logs', count(*) FROM audit_logs
UNION ALL SELECT 'compteurs_reference', count(*) FROM compteurs_reference
ORDER BY 1;"

echo
echo "✅ Purge terminée (niveau : $NIVEAU)."
echo
echo "À faire ensuite :"
echo "  1. Reconnecter chaque technicien sur SON téléphone (le verrou d'appareil"
echo "     se réarme au premier login — vérifiez que c'est le bon appareil)."
echo "  2. Vider l'application mobile de chaque téléphone de test"
echo "     (Paramètres Android → Applications → E&M OpS → Stocker → Effacer),"
echo "     sinon la file d'attente hors-ligne renverra des saisies de test."
if [ "$NIVEAU" = "total" ]; then
echo "  3. Réimporter le parc : Sites → Importer, puis lots, prestataires,"
echo "     contacts, topologie de transmission."
fi
echo "  4. Réactiver la situation périodique si elle était à 0"
echo "     (Administration → Paramètres → notifications.situationIntervalleH)."
echo "  5. ATTENTION : la passerelle SMS Moov est ACTIVE — les premiers"
echo "     événements réels déclencheront de VRAIS envois."
