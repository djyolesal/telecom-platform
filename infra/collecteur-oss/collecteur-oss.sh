#!/usr/bin/env bash
# Collecteur OSS → E&M OpS : pousse l'état des eNodeB vers la plateforme.
# À installer en cron (toutes les 5 min) sur une machine qui joint le nœud OSS.
#
#   */5 * * * * /opt/collecteur-oss/collecteur-oss.sh >> /var/log/collecteur-oss.log 2>&1
#
# Configuration par variables d'environnement (ou éditer ci-dessous) :
#   OSS_HOST     hôte SSH du nœud (ex. user@10.x.x.x) — clé SSH sans mot de passe
#   OSS_COMMANDE la commande qui produit le tableau d'état
#   EMOPS_URL    https://emops.uk/api/v1/coupures-reseau/sync-oss
#   EMOPS_TOKEN  jeton machine (OSS_SYNC_TOKEN du serveur E&M OpS)
set -euo pipefail

: "${OSS_HOST:?OSS_HOST requis}"
: "${OSS_COMMANDE:?OSS_COMMANDE requise}"
: "${EMOPS_URL:=https://emops.uk/api/v1/coupures-reseau/sync-oss}"
: "${EMOPS_TOKEN:?EMOPS_TOKEN requis}"

ssh -o ConnectTimeout=15 -o BatchMode=yes "$OSS_HOST" "$OSS_COMMANDE" \
  | curl -sS --max-time 60 -X POST "$EMOPS_URL" \
      -H "Authorization: Bearer $EMOPS_TOKEN" \
      -H "Content-Type: text/plain" \
      --data-binary @-
echo  # saut de ligne dans le log
