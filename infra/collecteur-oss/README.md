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

## Installation (machine NOC ou toute machine voyant le nœud)
1. copier `collecteur-oss.sh` (ex. `/opt/collecteur-oss/`) ;
2. clé SSH sans mot de passe vers le nœud OSS ;
3. définir le jeton : générer une valeur longue aléatoire, la mettre dans le
   `.env` du serveur E&M OpS (`OSS_SYNC_TOKEN=…`, puis `docker compose up -d api`)
   ET dans l'environnement du cron (`EMOPS_TOKEN=…`) ;
4. cron : `*/5 * * * * OSS_HOST=… OSS_COMMANDE='…' EMOPS_TOKEN=… /opt/collecteur-oss/collecteur-oss.sh >> /var/log/collecteur-oss.log 2>&1`

Test manuel : lancer le script une fois — la réponse JSON donne le bilan
(lignes analysées, coupures créées/clôturées, rapprochements adoptés, restants).
