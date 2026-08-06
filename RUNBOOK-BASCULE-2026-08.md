# Runbook de bascule — mise en production grand public (préparé le 05/08/2026)

Ordre exact des opérations, points de contrôle et critères de retour arrière pour la mise en
service d'E&M OpS. Chaque phase se termine par un **point de contrôle (✋)** : on ne passe à la
suivante que s'il est vert. Les commandes serveur s'exécutent dans `/opt/telecom-platform`
(connexion SSH par tes soins — les identifiants ne passent jamais par un tiers).

**Contenu du train** : migrations `0038` → `0042` (coût dépotages, clôture BL, référentiels
chauffeur/véhicule avec backfill, mouvements carburant, certificat de jaugeage), Next 15 +
React 19 + next-auth bêta.32, correctif nginx du rate-limit de session, aiguillage serveur du
tableau de bord, et l'ensemble des évolutions carburant / énergie / coupures / carte.

**Trois ruptures de compatibilité à avoir en tête pendant toute la bascule :**
1. la création d'un BL **exige un chauffeur** → un APK antérieur est refusé ;
2. le geofencing **bloque un dépotage sans GPS** sur un site géolocalisé ;
3. l'auth WebSocket exige `sid`+`plt` → tous les clients doivent se **reconnecter**.

**⚠️ SMS réels** : la passerelle Moov est ACTIVE en prod. Tout test qui déclenche une
notification (création d'incident, coupure totale, alerte) **envoie de vrais SMS**. Pour la
recette, utiliser des contacts de test ou vérifier le plafond SMS avant.

---

## Phase 0 — Préparatifs (J−1, sans toucher à la prod)

- [ ] Annonce aux utilisateurs : coupure de service ~30 min, reconnexion obligatoire ensuite.
- [ ] Fenêtre choisie hors heures de tournée carburant (éviter un transporteur en pleine saisie).
- [ ] **APK construit et testé sur un téléphone réel** AVANT la fenêtre (phase 4 ci-dessous —
      le build peut se faire la veille, seule la distribution attend la bascule).
- [ ] Vérifier l'espace disque serveur : `df -h` (les images Docker + le backup doivent tenir).
- [ ] Lister les migrations en attente pour confirmer l'état :
      `docker compose exec api npx prisma migrate status` → doit annoncer 0038…0042 non appliquées.

✋ **Contrôle** : APK testé OK sur téléphone, fenêtre annoncée, disque > 5 Go libres.

---

## Phase 1 — Point de retour (le filet, avant tout le reste)

```bash
make backup
```

- [ ] Vérifier la présence ET la taille des deux archives du jour :
      `ls -lh /opt/telecom/backups/db_*.sql.gz /opt/telecom/backups/minio_*.tar.gz`
- [ ] Vérifier que la copie hors-site est partie (si `BACKUP_REMOTE` configuré).
- [ ] Noter le commit actuellement déployé (pour le retour arrière) :
      `git rev-parse HEAD > /opt/telecom/backups/commit-avant-bascule.txt`

✋ **Contrôle** : backup du jour présent, non vide, hors-site confirmé, commit noté.

---

## Phase 2 — Déploiement du code

```bash
git pull origin develop
docker compose build api web        # long : Next 15 se compile
docker compose up -d --no-deps api web
docker compose exec api npx prisma migrate deploy
docker compose restart nginx        # nouvelle zone authjs_session_limit
```

(Équivalent : `make update` puis `docker compose restart nginx` — le restart nginx n'est PAS
dans `make update`, ne pas l'oublier : sans lui, les sessions web continueront de tomber.)

- [ ] `docker compose ps` → tous les conteneurs `Up`, aucun en redémarrage en boucle.
- [ ] `docker compose logs --tail=50 nginx` → pas d'erreur de syntaxe de configuration.
- [ ] `docker compose logs --tail=100 api` → démarrage propre, scheduler lancé, pas de
      `MissingSecret` ni d'erreur Prisma.
- [ ] **Prisma 7** (premier démarrage sur cette version) :
      `docker compose exec api npx prisma migrate status` répond depuis l'image (la CLI est
      embarquée — plus de téléchargement npx) et sans erreur de configuration ; les logs API ne
      montrent aucune erreur d'adapter pg.
- [ ] `migrate deploy` a listé 0038, 0039, 0040, 0041, 0042 appliquées. Les backfills 0040
      (véhicules/chauffeurs depuis l'existant) s'exécutent dans la migration : vérifier
      `docker compose exec postgres psql -U <user> -d <db> -c "SELECT count(*) FROM vehicules;"`
      → non nul si des BL existaient.
- [ ] `curl -s https://emops.uk/api/v1/health` → OK.
- [ ] `curl -s https://emops.uk/api/auth/session` → `null` HTTP 200 (Next répond).

**Si `migrate deploy` échoue** : ne PAS improviser de SQL en prod. Restaurer le backup
(phase R), revenir au commit noté, diagnostiquer à froid. Les migrations 0038-0042 sont
additives (`IF NOT EXISTS` partout) : un échec signalerait un état de base inattendu.

✋ **Contrôle** : conteneurs stables 5 minutes, santé API et auth OK, migrations toutes passées.

---

## Phase 3 — Recette humaine (la partie que rien n'automatise)

**D'abord la recette AUTOMATISÉE** (couvre l'auth, la stabilité de session, l'aiguillage
transporteur et les pages de synthèse — en lecture seule, aucun SMS déclenché) :

```bash
cd apps/web
npx playwright install chromium          # une fois par machine
E2E_BASE_URL=https://emops.uk \
E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... \
E2E_TRANSPORTEUR_EMAIL=... E2E_TRANSPORTEUR_PASSWORD=... \
npm run e2e
```

- [ ] Les 11 tests passent (rapport HTML dans `playwright-report/` en cas d'échec).
      Identifiants saisis par l'opérateur, jamais écrits dans un fichier.

Puis la recette MANUELLE, sur **navigation privée** (aucun cookie d'avant la bascule) — elle
couvre ce que l'automate ne voit pas (contenus métier, mobile, charge NAT) :

**Authentification (critique — Next 15/next-auth ont changé)**
- [ ] Connexion admin → menu complet par groupes, nom affiché en bas de barre (pas « U »).
- [ ] Naviguer vite entre 6-8 pages → AUCUN menu qui se vide (le 429 de session est corrigé).
- [ ] Déconnexion → retour login ; reconnexion → OK.
- [ ] Connexion transporteur → tableau de bord « Mes chargements » (jamais le général).
- [ ] Connexion superviseur prestataire → ses lots seulement (Sites, bilans périmétrés).

**Par rôle, une action représentative chacun**
- [ ] Manager : ouvrir un BC → Rapprochement (bandeau « arrêté anticipé » si mois en cours).
- [ ] Manager : créer un BL de test SANS chauffeur → refus explicite ; AVEC chauffeur → créé
      (avertissement jaugeage attendu si camion sans certificat). Le supprimer ensuite.
- [ ] NOC : importer le rapport coupures du jour → le récapitulatif affiche
      « N incident(s) résolu(s) automatiquement » et le stock d'incidents orphelins se résorbe.
- [ ] Supervision carte (interne) : tuiles OSM + pastilles + temps réel connecté.
- [ ] Transporteur : carte « mes livraisons » (pastilles par camion), export PDF d'un plan.
- [ ] Bilan carburant et Bilan énergie : période « Ce mois », les chiffres tombent, export XLSX.
- [ ] Direction : tableau de bord direction + les deux bilans.

**Mobile (téléphone réel, nouvel APK)**
- [ ] Connexion technicien (le verrou d'appareil accepte le téléphone).
- [ ] Un dépotage complet de test : plan → jauges → 6 photos → 3 signatures → GPS → envoi.
- [ ] Mode avion pendant la saisie → l'entrée part en file → repasse en ligne → synchronisée.
- [ ] Transporteur mobile : « Mes chargements », détail du plan, export PDF.

**Charge NAT (le point ouvert)**
- [ ] 3-4 personnes naviguent simultanément depuis le même réseau (même IP publique) pendant
      5 minutes → aucune erreur 429 dans l'onglet Réseau. Si des 429 apparaissent sur
      `/api/v1/*` : élargir `api_limit` dans `infra/nginx/nginx.conf` (p. ex. 300r/m,
      burst 100), recharger nginx, retester.

✋ **Contrôle** : tout coché. Un échec d'authentification = retour arrière (phase R), pas de
rustine en production.

---

## Phase 4 — APK

```bash
cd apps/mobile
flutter build apk --release --dart-define=API_URL=https://emops.uk/api/v1
```

- [ ] Tester l'APK sur un téléphone AVANT distribution (login + un dépotage de test).
- [ ] Distribuer à TOUS les techniciens et transporteurs **le jour de la bascule** (canal
      habituel), avec le message : « mise à jour OBLIGATOIRE — l'ancienne version ne peut
      plus créer de bons de livraison ni se synchroniser ».
- [ ] Vérifier auprès de 2-3 utilisateurs pilotes que l'installation passe (signature du
      paquet identique → mise à jour par-dessus, pas de désinstallation).

✋ **Contrôle** : APK installé et fonctionnel chez les pilotes.

---

## Phase 5 — Mise en service des données (le passage TEST → RÉEL)

**Dans cet ordre — la purge d'abord, les comptes ensuite :**

- [ ] **Changer le mot de passe du serveur** (il a transité en clair pendant la préparation)
      et vérifier `fail2ban`/UFW actifs. À faire par toi directement.
- [ ] S'assurer qu'un compte ADMIN réel et actif existe (son e-mail sert de pivot à la purge).
- [ ] `make purge-mise-en-service` — mode **exploitation** : conserve sites, topologie, GE,
      prestataires, lots, contacts, utilisateurs ; efface l'activité de test (interventions,
      relevés, dépotages, coupures, BC/BL, mouvements, camions et chauffeurs de test,
      compteurs de références → les MNT/INC/DEP-2026-00001 réels partent de 1).
- [ ] Créer le **second compte admin** (jamais un seul accès).
- [ ] Créer les comptes réels restants (managers, superviseurs, NOC, transporteurs,
      techniciens) — mots de passe saisis par toi ou par les intéressés, jamais dictés.
- [ ] Contrôler les paramètres système : prix du litre (`ge.prixLitreFCFA`), tarif kWh
      (`energie.prixKwhFCFA`), seuils manquants/stock, plafond SMS.
- [ ] Vérifier les contacts SMS (bons numéros, bons sites) — la passerelle est réelle.
- [ ] Premier BC réel du trimestre saisi (avec son PDF), pour que la chaîne carburant démarre.

✋ **Contrôle** : `SELECT count(*)` proche de zéro sur les tables d'activité, sites et lots
intacts, deux admins actifs, connexion avec un compte réel OK.

---

## Phase 6 — Pilote (1 à 2 semaines avant généralisation)

Périmètre conseillé : **une région + un transporteur**.

Critères de sortie (tous nécessaires) :
- [ ] ≥ 10 dépotages réels synchronisés sans intervention manuelle ;
- [ ] 1 cycle BL complet : création (chauffeur déclaré) → plan → livraisons → clôture ventilée ;
- [ ] 5 jours consécutifs d'import NOC sans incident orphelin ni site fantôme ;
- [ ] l'alerte quotidienne de 9 h reçue et jugée UTILE (pas de bruit) par le manager ;
- [ ] la part de sites « mesurés » (source conso) progresse — signe que les jauges/index
      rentrent ;
- [ ] zéro 429 et zéro déconnexion intempestive signalées.

Pendant le pilote : surveiller `docker compose logs -f api` une fois par jour, Grafana
(mémoire API < 80 % du gigaoctet, disque), et le tableau « À traiter » des manquants.

---

## Phase R — Retour arrière (à tout moment des phases 2-5)

**Critères de déclenchement** : authentification cassée non corrigée en < 30 min ; migration
échouée ; perte de données constatée ; API instable (redémarrages en boucle).

```bash
# 1. Revenir au code d'avant
git checkout $(cat /opt/telecom/backups/commit-avant-bascule.txt)
docker compose build api web
docker compose up -d --no-deps api web
docker compose restart nginx

# 2. SEULEMENT si les migrations 0038+ posent problème : restaurer la base
make restore    # choisir le backup de la phase 1
```

Notes :
- les migrations 0038-0042 sont **additives** : l'ancien code tourne sans problème sur une
  base déjà migrée — dans la plupart des cas, restaurer la base est INUTILE (et fait perdre
  les saisies faites entre-temps). Ne restaurer que si la base elle-même est corrompue.
- l'ancien APK redevient compatible avec l'ancien code : pas d'action mobile au rollback.
- après tout retour arrière : diagnostiquer À FROID sur ce dépôt, jamais en direct en prod.

---

## Après la généralisation (rappels)

- Exercice de restauration complet chronométré sur une machine vierge (mesurer le vrai RTO).
- Supervision externe (ping + alerte) et traçage d'erreurs applicatif.
- Version minimale d'APK exigée par l'API (éviter les APK zombies à la prochaine rupture).
- Étendre la suite E2E (11 tests aujourd'hui : auth, session, transporteur, synthèses) aux
  parcours d'ÉCRITURE sur un environnement de test dédié (création BL, plan, clôture) — ils ne
  peuvent pas tourner contre la prod (SMS réels, données réelles).
