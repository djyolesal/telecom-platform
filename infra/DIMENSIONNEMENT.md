# Dimensionnement du serveur

Ce document sert à décider d'un achat ou d'une extension. Les chiffres viennent
de deux sources, jamais d'une règle générale : les **limites déclarées dans
`docker-compose.yml`** et des **mesures faites sur la production** le
24/09/2026 (558 sites actifs, parc mobile en cours de déploiement).

---

## 1. Ce que la pile réclame

Les limites mémoire des conteneurs totalisent **7,6 Go** :

| Service | Limite | Rôle |
|---|---:|---|
| `telecom_postgres` (TimescaleDB) | 3 Go | Base de données |
| `telecom_redis` | 1,25 Go | Cache, files, sessions |
| `telecom_api` | 1 Go | API REST + socket temps réel |
| `telecom_web` | 768 Mo | Portail (rendu serveur Next.js) |
| `telecom_minio` | 512 Mo | Photos, signatures, PDF |
| `telecom_prometheus` | 512 Mo | Métriques (rétention 30 j) |
| `telecom_grafana` | 256 Mo | Tableaux de bord |
| `telecom_nginx` | 128 Mo | Terminaison TLS, proxy |
| Alertmanager + exporters | 192 Mo | Alertes, sondes |
| **Total** | **7,6 Go** | |

PostgreSQL est réglé à `shared_buffers=512 Mo`, `effective_cache_size=2 Go`,
200 connexions ; l'API ouvre un pool de 20 (`connection_limit=20`).

> `effective_cache_size=2 Go` est une **promesse faite au planificateur de
> requêtes** : il suppose que 2 Go de données seront servis depuis le cache du
> système. Si la mémoire libre de l'hôte tombe sous ce seuil, PostgreSQL
> continue de choisir ses plans comme si le cache existait — et les requêtes
> s'effondrent sans qu'aucun réglage n'ait changé.

---

## 2. Configuration recommandée

| | Minimum | **Recommandé** | Confortable |
|---|---|---|---|
| vCPU | 2 | **4** | 8 |
| RAM | 8 Go | **16 Go** | 32 Go |
| Disque | 250 Go SSD | **500 Go NVMe** | 1 To NVMe |
| Système | Ubuntu 22.04 LTS ou Debian 12 | | |

**Pourquoi 16 Go et pas 8.** Huit gigaoctets couvrent tout juste la somme des
limites : il ne reste rien pour le système ni pour le cache disque. Ce n'est
pas une marge de confort, c'est la condition pour que le réglage de PostgreSQL
ci-dessus reste vrai — et pour qu'un pic (export volumineux, import, rafale de
photos) ne fasse pas tuer un conteneur par le noyau.

**Pourquoi 4 vCPU.** Quatre charges tournent en parallèle : l'API, le rendu du
portail, la base, et les travaux nocturnes (rapports, sauvegardes), auxquels
s'ajoute le passage du collecteur OSS **chaque minute**.

**Pourquoi du NVMe.** PostgreSQL et MinIO écrivent en continu ; le disque est
ce qui limite en premier, bien avant le processeur.

---

## 3. État du serveur actuel (mesuré le 24/09/2026)

| Poste | Mesure | Verdict |
|---|---|---|
| CPU | 8 cœurs | ✅ au-dessus du recommandé |
| RAM | **7,6 Go** pour 7,6 Go de limites | ⚠️ **à la limite exacte — passer à 16 Go** |
| Swap | 7,9 Go (12 Mo utilisés) | Présent, signe d'un taillage juste |
| Disque | 449 Go, dont 270 utilisés | ✅ après purge du cache (voir §6) : ~12 Go utilisés |
| Base PostgreSQL | 103 Mo | ✅ négligeable |
| Photos (MinIO) | 11,45 Go | Poste de croissance principal |
| Sauvegardes | 404 Mo | ⚠️ voir §5 |

**La RAM est le seul poste sous-dimensionné**, et c'est le plus probable
suspect des erreurs 502 remontées par le terrain : `telecom_api` est plafonnée
à 1 Go, le noyau la tue quand elle dépasse, `restart: unless-stopped` la
relance, et nginx répond 502 pendant la fenêtre de redémarrage.

---

## 4. Croissance des données

Ce qui grossit, ce sont les **photos** — pas la base.

Base de calcul : une clôture de maintenance préventive exige **6 photos
minimum** (`MIN_PHOTOS_PREVENTIVE`), les photos sont bornées à 1600 × 1600 en
qualité 70-85 côté mobile, soit **≈ 250 Ko l'unité**.

| Source | Volume mensuel estimé |
|---|---|
| Maintenances préventives (558 sites, ~1/mois, ≥6 photos) | ~3 400 photos |
| Dépotages (jauges, compteur, bon, signature) | ~2 000–4 000 photos |
| Incidents et mouvements de carburant | ~1 000–2 000 photos |
| **Total** | **~1,5 à 2,5 Go/mois, soit 20 à 30 Go/an** |

La base PostgreSQL restera sous quelques gigaoctets par an : elle ne stocke que
des lignes et les **chemins** des fichiers, jamais les fichiers eux-mêmes.

Pour vérifier la projection sur vos chiffres du moment :

```bash
docker exec telecom_postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -tAc "select pg_size_pretty(pg_database_size(current_database()))"
docker system df -v | grep -E "minio_data|postgres_data"
```

---

## 5. Sauvegardes : le poste qui décide de la taille du disque

`infra/scripts/backup.sh` fait deux choses par passage : un `pg_dump`
compressé, et une **archive complète du volume MinIO** (`tar czf` de tout, pas
d'incrémental). Rétention locale : **30 jours**.

Conséquence : des photos JPEG ne se compressent pratiquement pas, donc
**30 jours × la totalité des photos**. À 11,45 Go aujourd'hui, cela représente
~345 Go ; à 40 Go de photos dans deux ans, 1,2 To — sur le même disque que la
production.

**Politique recommandée** :

| Élément | Fréquence | Rétention | Volume |
|---|---|---|---|
| `pg_dump` compressé | quotidien | 30 jours | < 1 Go |
| Archive MinIO | **hebdomadaire** | 4 semaines | ~4 × la taille des photos |

Ou mieux : remplacer le `tar` complet par un **`rsync` incrémental** vers la
destination hors-site — le volume devient celui des photos, une seule fois.

> **Contrôle à faire** : si `/opt/telecom/backups` ne contient que des
> `db_*.sql.gz` et aucun `minio_*.tar.gz`, **les photos ne sont pas
> sauvegardées**. Le script prévient (« Volume MinIO introuvable — définissez
> `MINIO_VOLUME` ») puis continue sans échouer. La base seule ne permet pas de
> les reconstruire : elle ne contient que leurs chemins.
>
> ```bash
> ls -la /opt/telecom/backups | tail -20
> grep MINIO_VOLUME .env || echo "MINIO_VOLUME absent du .env"
> ```

Et sans `BACKUP_REMOTE` défini, une panne disque emporte la base **et** ses
sauvegardes en même temps.

---

## 6. Pièges constatés en production

**Cache de construction Docker — 260 Go.** `make update` reconstruit les images
à chaque déploiement ; le cache BuildKit s'accumule sans jamais être purgé. Il
occupait 64 % du disque pour 12 Go de données réelles. `docker system prune`
**ne suffit pas** : il ne retire que le cache orphelin, or l'essentiel est du
cache encore référencé.

```bash
docker builder prune -af   # récupération immédiate, sans risque
```

`make update` purge désormais le cache automatiquement (10 Go conservés) et
`make clean` fait le nettoyage complet.

**L'alerte disque ne vous aurait pas prévenu** : elle se déclenche à 80 %, le
cache plafonnait à 64 %. Une croissance lente sous le seuil reste invisible.

**Aucune alerte sur un conteneur tué pour dépassement mémoire.** Les règles
d'`infra/prometheus/alerts.yml` surveillent la mémoire de l'**hôte** (> 90 %) ;
or un conteneur qui atteint SA limite est tué sans que l'hôte soit saturé —
et Prometheus ne collecte aujourd'hui aucune métrique par conteneur (pas de
cAdvisor). C'est exactement le scénario des 502 : la plateforme redémarre et
personne n'est prévenu. Combler ce trou demande soit cAdvisor, soit une sonde
qui lit `RestartCount` / `OOMKilled`.

---

## 7. Quand faut-il grossir

| Signal | Seuil | Action |
|---|---|---|
| Mémoire disponible de l'hôte | < 1,5 Go de façon durable | Ajouter de la RAM |
| `telecom_api` tuée pour mémoire | `docker inspect … .State.OOMKilled` = true | Ajouter de la RAM, ou relever `mem_limit` |
| Disque | > 80 % (alerte déjà en place) | Purger le cache, revoir la rétention |
| Photos | > 150 Go | Étendre le disque ou externaliser MinIO |
| Latence des pages | > 2 s en heure pleine | Regarder le CPU **et** le cache PostgreSQL |

Commande de contrôle complète :

```bash
echo "— RAM/CPU —"; free -h; nproc
echo "— disque —"; df -h /
echo "— conteneurs —"; docker stats --no-stream
echo "— redémarrages —"; docker inspect telecom_api \
  --format 'redémarrages={{.RestartCount}} tué_OOM={{.State.OOMKilled}}'
echo "— volumes —"; docker system df
echo "— sauvegardes —"; du -sh /opt/telecom/backups
```
