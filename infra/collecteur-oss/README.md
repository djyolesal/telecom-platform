# Collecteur OSS — détection automatique des coupures

Pousse la sortie brute de la commande d'état des eNodeB vers
`POST /api/v1/coupures-reseau/sync-oss` (jeton machine `OSS_SYNC_TOKEN`).

Le serveur parse chaque ligne `…Macro-<nodeId> | <name> connected|disconnected <date>` :
- `disconnected` → coupure « SITE » ouverte (source OSS), datée de la coupure ;
- `connected` avec coupure OSS ouverte → clôture, datée de la reconnexion.

**Mode observation** (état actuel) : les coupures OSS s'affichent (listes, carte
NOC, badge AUTO) mais ne déclenchent NI incident, NI SMS, NI propagation aval.
L'armement des notifications est un second temps, après validation du
rapprochement, avec anti-rebond.

## Rapprochement nodeId ↔ site
- automatique STRICT à la volée : nom OSS (préfixe GL/L retiré) exactement égal
  au nom du site — le nodeId est alors adopté et persisté ;
- sinon : fiche du site → Modifier → « NodeID OSS » ;
- la réponse du POST liste `disconnectedNonRapproches` : les sites down qui
  échappent encore à la détection — à mapper en priorité.

## Topologie d'accès en cascade

Le nœud OSS n'a pas internet et n'est parfois joignable qu'à travers un ou
plusieurs rebonds. Le collecteur s'installe TOUJOURS sur la machine qui a
internet (noeud1) ; le SSH traverse les rebonds :

    noeud1 (internet, cron ici) ──ssh──▶ noeud2 (pas internet) ──ssh──▶ nœud OSS

Deux modes selon la réalité du réseau :
- **`OSS_MODE=jump`** (défaut) : `ssh -J noeud2 oss` — noeud2 relaie le TCP,
  l'authentification se fait de bout en bout avec la clé de noeud1 (elle doit
  être acceptée par noeud2 ET par le nœud OSS) ;
- **`OSS_MODE=cascade`** : `ssh noeud2 "ssh oss '<commande>'"` — pour les cas
  où le port SSH du nœud OSS n'est joignable que DEPUIS noeud2 (filtrage
  strict). Clés : noeud1 → noeud2, puis la clé DE noeud2 → nœud OSS.

Commencer par `jump` ; si le saut final échoue (timeout), basculer `cascade`.

## Installation (sur noeud1)
1. copier `collecteur-oss.sh` (ex. `/opt/collecteur-oss/`) ;
2. mettre en place les clés SSH sans mot de passe selon le mode (ci-dessus) ;
3. définir le jeton : générer une valeur longue aléatoire, la mettre dans le
   `.env` du serveur E&M OpS (`OSS_SYNC_TOKEN=…`, puis `docker compose up -d api`)
   ET dans l'environnement du cron (`EMOPS_TOKEN=…`) ;
4. cron :
   `*/5 * * * * OSS_JUMP=user@noeud2 OSS_HOST=user@oss OSS_COMMANDE='…' EMOPS_TOKEN=… /opt/collecteur-oss/collecteur-oss.sh >> /var/log/collecteur-oss.log 2>&1`

Test manuel : d'abord la chaîne SSH seule
(`OSS_JUMP=… OSS_HOST=… ssh -J "$OSS_JUMP" "$OSS_HOST" '<commande>' | head`),
puis le script complet — la réponse JSON donne le bilan (lignes analysées,
coupures créées/clôturées, rapprochements adoptés, restants).
