#!/usr/bin/env bash
# Collecteur OSS → E&M OpS : pousse l'état des eNodeB vers la plateforme.
# S'INSTALLE SUR LA MACHINE QUI A INTERNET (noeud1). Le nœud OSS est atteint
# en cascade SSH à travers le(s) rebond(s) sans internet :
#
#   noeud1 (internet) ──ssh──▶ noeud2 ──ssh──▶ nœud OSS (commande)
#
# Cron (toutes les 5 min) :
#   */5 * * * * /opt/collecteur-oss/collecteur-oss.sh >> /var/log/collecteur-oss.log 2>&1
#
# Configuration par variables d'environnement (ou éditer ci-dessous) :
#   OSS_HOST     hôte SSH du nœud final (ex. user@10.x.x.x)
#   OSS_JUMP     rebond(s) intermédiaire(s) (ex. user@noeud2 — plusieurs : a,b)
#   OSS_MODE     'jump' (défaut, ProxyJump -J) ou 'cascade' (ssh dans ssh —
#                si le port SSH du nœud final n'est joignable QUE depuis noeud2)
#   OSS_COMMANDE la commande qui produit le tableau d'état
#   EMOPS_URL    https://emops.uk/api/v1/coupures-reseau/sync-oss
#   EMOPS_TOKEN  jeton machine (OSS_SYNC_TOKEN du serveur E&M OpS)
#
# Clés SSH sans mot de passe requises :
#   mode jump    : la clé de noeud1 acceptée par noeud2 ET par le nœud OSS
#   mode cascade : noeud1 → noeud2, puis noeud2 → nœud OSS
set -euo pipefail

: "${OSS_HOST:?OSS_HOST requis}"
: "${OSS_COMMANDE:?OSS_COMMANDE requise}"
: "${OSS_JUMP:=}"
: "${OSS_MODE:=jump}"
: "${EMOPS_URL:=https://emops.uk/api/v1/coupures-reseau/sync-oss}"
: "${EMOPS_TOKEN:?EMOPS_TOKEN requis}"

SSH_OPTS=(-o ConnectTimeout=15 -o BatchMode=yes)

recolter() {
  if [ -z "$OSS_JUMP" ]; then
    ssh "${SSH_OPTS[@]}" "$OSS_HOST" "$OSS_COMMANDE"
  elif [ "$OSS_MODE" = "cascade" ]; then
    # ssh dans ssh : la commande transite par noeud2, qui ouvre lui-même la
    # session vers le nœud final (sa propre clé fait foi sur ce dernier saut).
    ssh "${SSH_OPTS[@]}" "$OSS_JUMP" "ssh -o ConnectTimeout=15 -o BatchMode=yes $OSS_HOST '$OSS_COMMANDE'"
  else
    ssh "${SSH_OPTS[@]}" -J "$OSS_JUMP" "$OSS_HOST" "$OSS_COMMANDE"
  fi
}

recolter | curl -sS --max-time 60 -X POST "$EMOPS_URL" \
  -H "Authorization: Bearer $EMOPS_TOKEN" \
  -H "Content-Type: text/plain" \
  --data-binary @-
echo  # saut de ligne dans le log
