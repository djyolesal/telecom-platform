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
# Configuration recommandée : le fichier `collecteur-oss.conf` placé À CÔTÉ de
# ce script (il survit aux mises à jour, contrairement aux valeurs éditées ici).
#   OSS_HOST     hôte SSH du nœud final (ex. user@10.x.x.x)
#   OSS_JUMP     rebond(s) intermédiaire(s) (ex. user@noeud2 — plusieurs : a,b)
#   OSS_MODE     'jump' (défaut, ProxyJump -J) ou 'cascade' (ssh dans ssh —
#                si le port SSH du nœud final n'est joignable QUE depuis noeud2)
#   OSS_PORT     port SSH du nœud final (défaut 22)
#   OSS_COMMANDE la commande qui produit le tableau d'état
#   EMOPS_URL    https://emops.uk/api/v1/coupures-reseau/sync-oss
#   EMOPS_TOKEN  jeton machine (OSS_SYNC_TOKEN du serveur E&M OpS)
#
# Clés SSH sans mot de passe requises :
#   mode jump    : la clé de noeud1 acceptée par noeud2 ET par le nœud OSS
#   mode cascade : noeud1 → noeud2, puis noeud2 → nœud OSS
set -euo pipefail

# ── Configuration PERSISTANTE ────────────────────────────────────────────────
# Un fichier À CÔTÉ du script, qui SURVIT à son remplacement. Éditer les
# variables dans le script lui-même (comme l'invitait l'en-tête) les faisait
# disparaître à chaque mise à jour : le collecteur repartait alors sur
# « OSS_HOST requis » et sortait en code 1 sans rien remonter.
#   /home/<user>/collecteur-oss/collecteur-oss.conf
#     OSS_HOST=user@10.x.x.x
#     OSS_JUMP=user@noeud2
#     OSS_MODE=cascade
#     OSS_COMMANDE='...'
#     EMOPS_TOKEN=...
# Le fichier contient un JETON : le réserver à son propriétaire (chmod 600).
# Noms acceptés, dans l'ordre : OSS_CONF, puis `collecteur-oss.conf`, puis
# `config.env` (nom déjà en service sur noeud1, où c'est la LIGNE DE CRON qui le
# source — le script le lit désormais lui-même, donc il fonctionne aussi lancé
# à la main, ce qui n'était pas le cas et rendait tout diagnostic trompeur).
ICI=$(dirname "$0")
for CONF in "${OSS_CONF:-}" "$ICI/collecteur-oss.conf" "$ICI/config.env"; do
  # shellcheck source=/dev/null
  [ -n "$CONF" ] && [ -r "$CONF" ] && { . "$CONF"; break; }
done

# Anti-chevauchement : à la cadence 1 min, un passage lent (SSH en cascade,
# réseau chargé) ne doit pas s'empiler sur le suivant - on saute simplement.
#
# `9>>` et NON `9>` : « > » tronque le fichier à CHAQUE invocation, y compris
# quand on n'obtient pas le verrou. Cela effaçait l'identité du détenteur et
# remettait la date du fichier à maintenant - l'âge calculé valait donc
# toujours 0 s et l'alerte « verrou coincé » ne pouvait JAMAIS se déclencher.
# OSS_LOCK vide = verrou interne DÉSACTIVÉ : à utiliser quand la ligne de cron
# enveloppe déjà le script dans `flock`, sinon les deux verrous se disputent le
# même fichier et le script ne peut JAMAIS l'obtenir. `${VAR-defaut}` (sans
# deux-points) pour qu'une valeur vide reste vide.
LOCK="${OSS_LOCK-/tmp/collecteur-oss.lock}"
if [ -n "$LOCK" ]; then
exec 9>>"$LOCK"
if ! flock -n 9; then
  # Le détenteur s'inscrit dans le fichier (PID + horodatage de début), seule
  # source fiable : la date du fichier, elle, ne dit rien.
  detenteur=$(head -n1 "$LOCK" 2>/dev/null || true)
  pid=${detenteur%% *}
  depuis=${detenteur##* }
  age=0
  case "${depuis:-}" in (*[!0-9]*|'') : ;; (*) age=$(( $(date +%s) - depuis )) ;; esac
  vivant="disparu"; [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null && vivant="vivant"
  # Fichier de verrou VIDE : le détenteur n'est pas un passage du collecteur
  # (aucun des nôtres ne s'y inscrit sans le remplir). C'est presque toujours un
  # `flock` EXTERNE — typiquement celui de la ligne de cron, qui prend le verrou
  # puis exécute ce script : le script ne pourra alors jamais l'obtenir, à
  # chaque passage, indéfiniment.
  if [ -z "$detenteur" ]; then
    echo "ALERTE: le verrou $LOCK est tenu par un processus ÉTRANGER au collecteur." >&2
    echo "        Cause la plus fréquente : la ligne de cron enveloppe déjà le script dans « flock »" >&2
    echo "        sur ce même fichier - les deux verrous se bloquent alors mutuellement, à vie." >&2
    echo "        Corriger : retirer flock de la ligne de cron (le script s'en charge lui-même)," >&2
    echo "        OU lancer avec OSS_LOCK= (vide) pour désactiver le verrou interne." >&2
    exit 0
  fi
  if [ "$age" -gt "${OSS_ALERTE_VERROU_S:-600}" ] || [ "$vivant" = "disparu" ]; then
    echo "ALERTE: verrou tenu par le PID ${pid:-?} ($vivant) depuis ${age}s - le collecteur ne remonte plus rien." >&2
    echo "        Débloquer : kill -9 ${pid:-<pid>} ; sinon identifier le porteur avec : fuser -v $LOCK" >&2
  else
    echo "passage précédent encore en cours (PID ${pid:-?}, ${age}s) - sauté"
  fi
  exit 0
fi
# Le verrou nous appartient : on s'inscrit comme détenteur (le tronquage passe
# par un AUTRE descripteur, sans relâcher notre verrou).
: > "$LOCK"
printf '%s %s\n' "$$" "$(date +%s)" >&9
fi

: "${OSS_HOST:?OSS_HOST requis}"
: "${OSS_COMMANDE:?OSS_COMMANDE requise}"
: "${OSS_JUMP:=}"
: "${OSS_MODE:=jump}"
: "${OSS_PORT:=22}"
: "${EMOPS_URL:=https://emops.uk/api/v1/coupures-reseau/sync-oss}"
: "${EMOPS_TOKEN:?EMOPS_TOKEN requis}"

# ConnectTimeout ne borne QUE l'établissement de la session : une commande
# distante qui se fige laisse ssh attendre pour toujours. Les sondes keepalive
# coupent une session morte, et `timeout` borne le passage entier - sans quoi
# un ssh figé retient le verrou et tue le collecteur définitivement.
SSH_OPTS=(-p "$OSS_PORT" -o ConnectTimeout=15 -o BatchMode=yes -o ServerAliveInterval=10 -o ServerAliveCountMax=3)
: "${OSS_TIMEOUT:=90}"
# `timeout` est GNU coreutils (présent sur noeud1) ; `gtimeout` sur macOS. S'il
# manque, on continue SANS borne plutôt que d'échouer - mais on le dit, car
# c'est précisément la garde qui empêche un ssh figé de tuer le collecteur.
if command -v timeout >/dev/null 2>&1; then BORNE=(timeout -k 10 "$OSS_TIMEOUT")
elif command -v gtimeout >/dev/null 2>&1; then BORNE=(gtimeout -k 10 "$OSS_TIMEOUT")
else BORNE=(); echo "ATTENTION: ni timeout ni gtimeout - un ssh figé ne sera pas interrompu." >&2; fi

# `9>&-` sur CHAQUE enfant : sans cela ssh, timeout et curl héritent du
# descripteur du verrou. Un ssh orphelin (session morte, processus resté en
# arrière-plan) continuait alors de tenir le verrou APRÈS la fin de son parent,
# et tous les passages suivants sortaient en « passage précédent encore en
# cours » pour toujours - le collecteur mort sans que rien ne tourne.
recolter() {
  if [ -z "$OSS_JUMP" ]; then
    ${BORNE[@]+"${BORNE[@]}"} ssh "${SSH_OPTS[@]}" "$OSS_HOST" "$OSS_COMMANDE" ${LOCK:+9>&-}
  elif [ "$OSS_MODE" = "cascade" ]; then
    # ssh dans ssh : la commande transite par noeud2, qui ouvre lui-même la
    # session vers le nœud final (sa propre clé fait foi sur ce dernier saut).
    ${BORNE[@]+"${BORNE[@]}"} ssh -o ConnectTimeout=15 -o BatchMode=yes \
      -o ServerAliveInterval=10 -o ServerAliveCountMax=3 "$OSS_JUMP" \
      "ssh -p $OSS_PORT -o ConnectTimeout=15 -o BatchMode=yes -o ServerAliveInterval=10 -o ServerAliveCountMax=3 $OSS_HOST '$OSS_COMMANDE'" ${LOCK:+9>&-}
  else
    ${BORNE[@]+"${BORNE[@]}"} ssh "${SSH_OPTS[@]}" -J "$OSS_JUMP" "$OSS_HOST" "$OSS_COMMANDE" ${LOCK:+9>&-}
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
  --data-binary @"$RECOLTE" ${LOCK:+9>&-}
echo  # saut de ligne dans le log
