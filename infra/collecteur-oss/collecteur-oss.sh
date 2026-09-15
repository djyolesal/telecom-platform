#!/usr/bin/env bash
# Collecteur OSS → E&M OpS : pousse l'état des eNodeB vers la plateforme.
# S'INSTALLE SUR LA MACHINE QUI A INTERNET (noeud1). Le nœud OSS est atteint
# en cascade SSH à travers le(s) rebond(s) sans internet :
#
#   noeud1 (internet) ──ssh──▶ noeud2 ──ssh──▶ nœud OSS (commande)
#
# Cron (toutes les minutes - décision exploitant 12/09/2026, détection quasi
# temps réel ; le verrou ci-dessous empêche deux passages de se chevaucher si
# la cascade SSH traîne) :
#   * * * * * /opt/collecteur-oss/collecteur-oss.sh >> /var/log/collecteur-oss.log 2>&1
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

# Anti-chevauchement : à la cadence 1 min, un passage lent (SSH en cascade,
# réseau chargé) ne doit pas s'empiler sur le suivant - on saute simplement.
exec 9>"/tmp/collecteur-oss.lock"
# Si le verrou est pris, on regarde DEPUIS QUAND. Un passage lent est normal ;
# un verrou vieux de plusieurs minutes signifie qu'un ssh est bloqué et retient
# le verrou - à la cadence 1 min, tous les passages suivants sortaient alors en
# silence et le collecteur restait mort sans une seule erreur. On le CRIE.
if ! flock -n 9; then
  horo=$(stat -c %Y "/tmp/collecteur-oss.lock" 2>/dev/null || stat -f %m "/tmp/collecteur-oss.lock" 2>/dev/null || date +%s)
  age=$(( $(date +%s) - horo ))
  if [ "$age" -gt "${OSS_ALERTE_VERROU_S:-600}" ]; then
    echo "ALERTE: verrou détenu depuis ${age}s - un passage est BLOQUÉ, le collecteur ne remonte plus rien." >&2
  else
    echo "passage précédent encore en cours (${age}s) - sauté"
  fi
  exit 0
fi
# Le verrou nous appartient : on l'horodate pour que le calcul ci-dessus mesure
# l'âge du passage EN COURS et non celui du fichier.
touch "/tmp/collecteur-oss.lock" 

: "${OSS_HOST:?OSS_HOST requis}"
: "${OSS_COMMANDE:?OSS_COMMANDE requise}"
: "${OSS_JUMP:=}"
: "${OSS_MODE:=jump}"
: "${EMOPS_URL:=https://emops.uk/api/v1/coupures-reseau/sync-oss}"
: "${EMOPS_TOKEN:?EMOPS_TOKEN requis}"

# ConnectTimeout ne borne QUE l'établissement de la session : une commande
# distante qui se fige laisse ssh attendre pour toujours. Les sondes keepalive
# coupent une session morte, et `timeout` borne le passage entier - sans quoi
# un ssh figé retient le verrou et tue le collecteur définitivement.
SSH_OPTS=(-o ConnectTimeout=15 -o BatchMode=yes -o ServerAliveInterval=10 -o ServerAliveCountMax=3)
: "${OSS_TIMEOUT:=90}"
# `timeout` est GNU coreutils (présent sur noeud1) ; `gtimeout` sur macOS. S'il
# manque, on continue SANS borne plutôt que d'échouer - mais on le dit, car
# c'est précisément la garde qui empêche un ssh figé de tuer le collecteur.
if command -v timeout >/dev/null 2>&1; then BORNE=(timeout -k 10 "$OSS_TIMEOUT")
elif command -v gtimeout >/dev/null 2>&1; then BORNE=(gtimeout -k 10 "$OSS_TIMEOUT")
else BORNE=(); echo "ATTENTION: ni timeout ni gtimeout - un ssh figé ne sera pas interrompu." >&2; fi

recolter() {
  if [ -z "$OSS_JUMP" ]; then
    ${BORNE[@]+"${BORNE[@]}"} ssh "${SSH_OPTS[@]}" "$OSS_HOST" "$OSS_COMMANDE"
  elif [ "$OSS_MODE" = "cascade" ]; then
    # ssh dans ssh : la commande transite par noeud2, qui ouvre lui-même la
    # session vers le nœud final (sa propre clé fait foi sur ce dernier saut).
    ${BORNE[@]+"${BORNE[@]}"} ssh "${SSH_OPTS[@]}" "$OSS_JUMP" \
      "ssh -o ConnectTimeout=15 -o BatchMode=yes -o ServerAliveInterval=10 -o ServerAliveCountMax=3 $OSS_HOST '$OSS_COMMANDE'"
  else
    ${BORNE[@]+"${BORNE[@]}"} ssh "${SSH_OPTS[@]}" -J "$OSS_JUMP" "$OSS_HOST" "$OSS_COMMANDE"
  fi
}

# On récolte D'ABORD dans un fichier : envoyer directement par un tube postait
# une récolte TRONQUÉE si la session mourait en cours de route (des sites ne
# figuraient alors ni connectés ni déconnectés, et leurs coupures ne pouvaient
# plus se clôturer). On ne POSTe qu'une récolte complète et plausible.
RECOLTE=$(mktemp); trap 'rm -f "$RECOLTE"' EXIT
# `if ! recolter` écraserait le code retour (le « ! » réussit toujours) : on le
# capture explicitement pour distinguer un figeage d'un échec de connexion.
rc=0
recolter > "$RECOLTE" || rc=$?
if [ "$rc" -ne 0 ]; then
  if [ "$rc" -eq 124 ]; then
    echo "ALERTE: récolte interrompue après ${OSS_TIMEOUT}s (commande OSS figée) - rien envoyé." >&2
  else
    echo "ALERTE: récolte en échec (code $rc) - rien envoyé." >&2
  fi
  exit 1
fi

lignes=$(grep -cE 'Macro-[0-9]+[[:space:]]*\|.*(connected|disconnected)' "$RECOLTE" || true)
if [ "$lignes" -eq 0 ]; then
  echo "ALERTE: récolte sans aucune ligne eNodeB exploitable - rien envoyé." >&2
  exit 1
fi
# Garde anti-troncature : une récolte qui perd plus de la moitié des nœuds par
# rapport à la précédente est suspecte. On ne l'envoie pas (le passage suivant
# est dans une minute) ; forcer avec OSS_SEUIL_TRONCATURE=0.
ETAT="${OSS_ETAT:-/tmp/collecteur-oss.dernier-total}"
precedent=$(cat "$ETAT" 2>/dev/null || echo 0)
seuil=${OSS_SEUIL_TRONCATURE:-50}
if [ "$precedent" -gt 0 ] && [ "$seuil" -gt 0 ] && [ $(( lignes * 100 / precedent )) -lt "$seuil" ]; then
  echo "ALERTE: récolte tronquée ($lignes nœuds contre $precedent au passage précédent) - rien envoyé." >&2
  exit 1
fi
echo "$lignes" > "$ETAT"

curl -sS --max-time 60 -X POST "$EMOPS_URL" \
  -H "Authorization: Bearer $EMOPS_TOKEN" \
  -H "Content-Type: text/plain" \
  --data-binary @"$RECOLTE"
echo  # saut de ligne dans le log
