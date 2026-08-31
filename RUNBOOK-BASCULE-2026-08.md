# Runbook de bascule — mise en production grand public
*(préparé le 05/08/2026 — mis à jour le 31/08/2026)*

Ordre exact des opérations, points de contrôle et critères de retour arrière pour la mise en
service d'E&M OpS. Chaque phase se termine par un **point de contrôle (✋)** : on ne passe à la
suivante que s'il est vert. Les commandes serveur s'exécutent dans `/opt/telecom-platform`
(connexion SSH par tes soins — les identifiants ne passent jamais par un tiers).

**Contenu du train** : migrations `0038` → `0053` (54 au total). Depuis la préparation initiale
se sont ajoutées : signature de l'agent de sécurité, gardiennage de nuit, synchronisation OSS et
prise en charge des coupures, **cuves** (barémage hauteur → litres), **contrat solaire** complet
(lots solaires distincts, checklist contractuelle), référentiels éditables (types d'incident,
équipements de dépannage), rapport de **conformité ARCEP (DR1/DR2)**, **récap journalier par
email**, mode **Topologie** de la carte, et le nettoyage des libellés (plus de jargon technique,
sites désignés par leur **nom**). APK courant : **1.5.0+34** (versionCode 2034).

**Cinq ruptures de compatibilité à avoir en tête pendant toute la bascule :**
1. la création d'un BL **exige un chauffeur** → un APK antérieur est refusé ;
2. le geofencing **bloque un dépotage sans GPS** sur un site géolocalisé ;
3. l'auth WebSocket exige `sid`+`plt` → tous les clients doivent se **reconnecter** ;
4. **🔴 NOUVEAU — signatures obligatoires** : le serveur refuse désormais TOUTE clôture sans
   **signature du technicien** (maintenance, incident) et tout dépotage sans **signature +
   nom du chauffeur** et signature du technicien. Un APK antérieur au b32 **ne peut plus rien
   clôturer** : l'API et l'APK **b34** doivent partir dans la MÊME fenêtre, jamais étalés ;
5. **NOUVEAU — photos exigées sur les dépannages** : une curative se clôture avec au moins
   2 photos (réglable). Un APK ancien ne les impose pas côté saisie → refus serveur.

**⚠️ SMS réels** : la passerelle Moov est ACTIVE en prod. Tout test qui déclenche une
notification (création d'incident, coupure totale, alerte) **envoie de vrais SMS**. Pour la
recette, utiliser des contacts de test ou vérifier le plafond SMS avant.
**Nouveau poste de coût** : un SMS « site rétabli » part désormais à chaque rétablissement
automatique d'un événement pris en charge, si la coupure a duré ≥ 15 min
(`sms.retabliMinMinutes`, mettre 0 pour couper le temps d'observer le volume).

---

## Phase 0 — Préparatifs (J−1, sans toucher à la prod)

- [ ] Annonce aux utilisateurs : coupure de service ~30 min, reconnexion obligatoire ensuite.
- [ ] Fenêtre choisie hors heures de tournée carburant (éviter un transporteur en pleine saisie).
- [ ] **APK b34 construit et testé sur un téléphone réel** AVANT la fenêtre (phase 4 ci-dessous —
      le build peut se faire la veille, seule la distribution attend la bascule). Rappel : à
      cause de la rupture nº4 (signatures), la distribution ne peut PAS attendre le lendemain.
- [ ] **SMTP configuré** sur le serveur (`SMTP_HOST`, `SMTP_FROM`…) : sans lui, le récap
      journalier de 23 h ne partira pas — le job le journalise sans erreur visible.
- [ ] Vérifier l'espace disque serveur : `df -h` (les images Docker + le backup doivent tenir).
- [ ] Confirmer l'état des migrations :
      `docker compose exec api npx prisma migrate status` → indique les migrations en attente.
      Le train comporte **54 migrations** au total ; celles de `0043` à `0053` restent à
      appliquer si la prod est encore au niveau du 05/08. Toute migration inattendue ici est
      une anomalie à comprendre AVANT la bascule.

✋ **Contrôle** : APK b34 testé OK sur téléphone, fenêtre annoncée, disque > 5 Go libres,
SMTP configuré.

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
- [ ] `migrate deploy` a listé toutes les migrations manquantes jusqu'à **0053**. Les backfills
      0040 (véhicules/chauffeurs depuis l'existant) s'exécutent dans la migration : vérifier
      `docker compose exec postgres psql -U <user> -d <db> -c "SELECT count(*) FROM vehicules;"`
      → non nul si des BL existaient.
- [ ] **Référentiels semés par les migrations** (0052/0053) — ils doivent être remplis, sinon
      les formulaires mobiles se retrouvent sans choix :
      `SELECT count(*) FROM types_incident_ref;` → ≥ 7 ·
      `SELECT count(*) FROM equipements_ref;` → **11** (ATS, TGBT, GE, compteur CEET, atelier
      d'énergie, redresseurs, climatiseur, batteries, panneaux/régulateur, pylône/balisage,
      antenne/FH).
- [ ] **Contrat solaire** : `SELECT count(*) FROM lots WHERE contrat='SOLAIRE';` → la valeur
      attendue est 0 tant que les lots solaires n'ont pas été créés (phase 5), pas une erreur.
- [ ] `docker compose logs --tail=100 api` → **10 cron jobs planifiés** (et non 9 : le récap
      journalier de 23 h s'est ajouté).
- [ ] `curl -s https://emops.uk/api/v1/health` → OK.
- [ ] `curl -s https://emops.uk/api/auth/session` → `null` HTTP 200 (Next répond).

**Si `migrate deploy` échoue** : ne PAS improviser de SQL en prod. Restaurer le backup
(phase R), revenir au commit noté, diagnostiquer à froid. Les migrations 0038-0053 sont
additives (`IF NOT EXISTS` partout) : un échec signalerait un état de base inattendu.

**⚠️ Enchaîner immédiatement sur la phase 4 (APK)** : entre le déploiement de l'API et
l'installation du b34, les mobiles en circulation **ne peuvent plus clôturer** (rupture nº4).
La recette (phase 3) peut se faire en parallèle de la distribution, pas avant.

✋ **Contrôle** : conteneurs stables 5 minutes, santé API et auth OK, migrations toutes passées.

---

## Phase 3 — Recette humaine (la partie que rien n'automatise)

**D'abord la recette AUTOMATISÉE** (couvre l'auth, la stabilité de session, l'aiguillage
transporteur et les pages de synthèse — en lecture seule, aucun SMS déclenché) :

> **Où l'exécuter : depuis TA machine, jamais sur le serveur.** La suite pilote un Chromium
> local qui attaque `https://emops.uk` comme un vrai utilisateur — elle traverse donc nginx,
> TLS et le rate-limit, ce qu'un `localhost` sur le VPS ne testerait pas. Installer Playwright
> sur le serveur consommerait en plus la RAM dont l'API a besoin. Seul prérequis : ta machine
> doit joindre `https://emops.uk`, et tu saisis les identifiants toi-même en variables
> d'environnement (jamais dans un fichier).

```bash
cd apps/web
npx playwright install chromium          # une fois par machine
E2E_BASE_URL=https://emops.uk \
E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... \
E2E_TRANSPORTEUR_EMAIL=... E2E_TRANSPORTEUR_PASSWORD=... \
npm run e2e
```

- [ ] Les tests passent : **12 passed** (2 setups de session + 10 tests sur 4 fichiers ;
      rapport HTML dans `playwright-report/` en cas d'échec).
      Identifiants saisis par l'opérateur, jamais écrits dans un fichier.

> **⚠️ Piège : « 2 passed, 10 skipped » n'est PAS une recette réussie.** Sans les variables
> d'environnement, les deux setups écrivent une session vide et « passent » en ~200 ms, puis
> les 10 vrais tests se sautent (`E2E_ADMIN_EMAIL/PASSWORD non fournis`). Un passage valide
> affiche **12 passed** (ou 9 si seul le compte admin est fourni — les 3 specs transporteur
> se sautent alors) et dure **~1 minute** (validé 12/12 en 1,1 min le 31/08/2026). Et sans `E2E_BASE_URL`, la suite vise
> `http://localhost:3000`, pas la production.

**Règles d'exécution de la suite — apprises à la dure (validée 12/12 le 06/08) :**
1. **Serveur au repos** : jamais pendant un `docker compose build` — le VPS ne
   sait pas compiler et servir les pages lourdes en même temps (faux négatifs
   en série sur les bilans et la stabilité).
2. **Un passage par quart d'heure maximum** : la suite partage l'anti-spraying
   de l'API (10 connexions/compte/15 min) avec les vrais utilisateurs. Elle
   n'en consomme plus qu'une par rôle (storageState), mais des passages en
   rafale mordent quand même sur le quota.
3. **Ne pas naviguer sur emops.uk avec les comptes de recette PENDANT un
   passage** : la session unique par plateforme révoquerait la session de la
   suite (et réciproquement).
4. **Verdict à la durée** : un passage sain fait ~1 minute ; au-delà de
   3 minutes, le passage était pollué (charge/quota) — le refaire au calme
   avant d'interpréter le moindre échec.

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

**Nouveautés depuis la préparation initiale (à passer une fois chacune)**
- [ ] **Signatures** — ouvrir une maintenance clôturée : le bloc « Signatures » apparaît sur la
      fiche web ; un emplacement attendu non signé affiche « Signature manquante » (et non un
      vide). Idem sur le PDF (bloc encadré, jamais tronqué en bas de page).
- [ ] **PDF de maintenance** : photos 3 par ligne sur toute la largeur, jusqu'à 6 par phase.
- [ ] **Conformité ARCEP** (Rapports → Conformité ARCEP) : le mois courant s'affiche, les
      compteurs DR1/DR2 tombent, l'export xlsx s'ouvre. Vérifier la case « inclure les
      détections non adoptées » (la colonne bascule) — les sites « exposé en audit » remontent.
- [ ] **Carte → Topologie** : les liaisons se tracent, la bascule « Par type / Par état »
      fonctionne, les racines (anneau plein) et isolés (anneau pointillé) se distinguent.
- [ ] **Coupures** : sur une détection auto DÉJÀ rétablie et non prise en charge, le bloc
      « Valider (compter dans la disponibilité) » apparaît ; une coupure < 5 min est refusée.
- [ ] **Solaire** (si des lots solaires existent) : un site hybride/solaire s'affecte à un lot
      solaire ; un site sans photovoltaïque est refusé avec un message clair.
- [ ] **Récap journalier** : attendre 23 h GMT le soir de la bascule (ou régler `recap.actif`
      puis relancer le conteneur pour tester) → l'email arrive aux superviseurs et internes,
      chacun avec SON périmètre, sections par contrat, **sites désignés par leur nom**.

**Mobile (téléphone réel, APK b34)**
- [ ] Connexion technicien (le verrou d'appareil accepte le téléphone).
- [ ] Un dépotage complet de test : plan → jauges → 6 photos → **signatures chauffeur (avec son
      NOM) + technicien** → GPS → envoi. Sans le nom du chauffeur : refus explicite.
- [ ] **Clôture d'une maintenance** : le pavé de signature du technicien est OBLIGATOIRE
      (valider à vide doit bloquer). Idem à la clôture d'un incident (nouveau).
- [ ] **Dépannage curatif** : choisir un équipement en panne (ATS, TGBT…) dans la liste,
      clôturer → au moins 2 photos exigées.
- [ ] **Mesure de cuve** depuis la fiche site : 3 photos exigées, les litres calculés
      correspondent à ceux du web pour la même hauteur.
- [ ] Mode avion pendant la saisie → l'entrée part en file → repasse en ligne → synchronisée.
      Vérifier au passage qu'aucun message technique ne s'affiche (« NetworkException », un
      code brut de statut) : les libellés doivent être en français métier.
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

L'APK **1.5.0+34** est déjà construit et déposé dans `~/Downloads/APK-emops/`
(`emops-1.5.0-b34-arm64.apk` + `.aab`, versionCode **2034**, signature `4955c7cf…`).
Pour le reconstruire à l'identique :

```bash
cd apps/mobile
flutter build apk --release --split-per-abi --dart-define=API_URL=https://emops.uk/api/v1
flutter build appbundle --release --dart-define=API_URL=https://emops.uk/api/v1
```

- [ ] Tester l'APK sur un téléphone AVANT distribution (login + un dépotage de test).
- [ ] **Distribuer sans attendre**, dans la même fenêtre que le déploiement API : depuis la
      rupture nº4, un mobile non mis à jour **ne peut plus clôturer** maintenance, incident ni
      dépotage. Message : « mise à jour **OBLIGATOIRE** — l'ancienne version ne peut plus
      clôturer d'intervention, ni créer de bon de livraison, ni se synchroniser ».
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
- [ ] **Nouveaux réglages à arbitrer avant l'ouverture** (Administration → Paramètres) :
      · `sms.retabliMinMinutes` (défaut **15**) — SMS « site rétabli » ; mettre **0** le temps
        d'observer le volume réel si le budget SMS est serré ;
      · `recap.actif` (défaut **1**) — récap journalier de 23 h ; le couper pendant la recette
        pour ne pas envoyer d'email à toute l'équipe sur des données de test ;
      · `maintenance.minPhotosCurative` (défaut **2**) — photos exigées sur un dépannage ;
      · `oss.dureeMinValidationCloturee` (défaut **5 min**) — durée sous laquelle une détection
        auto déjà rétablie ne peut pas être validée pour la disponibilité ;
      · `oss.armementDelaiMin` (défaut **0** = adoption manuelle par le NOC — ne pas activer
        sans décision explicite : l'armement automatique déclenche SMS et terrain).
- [ ] **Lots solaires** (si le contrat solaire démarre) : créer les lots de contrat SOLAIRE,
      y attribuer les prestataires (scope SOLAIRE), puis rattacher les sites — seuls les sites
      **hybrides ou solaires** sont acceptés.
- [ ] **Référentiels** : vérifier la liste des équipements de dépannage et des types
      d'incident (Administration) — ils pilotent les formulaires mobiles.
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
- [ ] zéro 429 et zéro déconnexion intempestive signalées ;
- [ ] **aucune clôture bloquée** faute de signature (signe qu'un mobile n'a pas été mis à jour :
      le vérifier tout de suite, l'agent ne peut plus travailler) ;
- [ ] le **récap de 23 h** arrive chaque soir et le contenu est jugé juste par les superviseurs ;
- [ ] le **volume de SMS « site rétabli »** est acceptable (sinon relever
      `sms.retabliMinMinutes` ou le mettre à 0) ;
- [ ] la **conformité ARCEP** du premier mois est cohérente avec le ressenti terrain.

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
- les migrations 0038-0053 sont **additives** : l'ancien code tourne sans problème sur une
  base déjà migrée — dans la plupart des cas, restaurer la base est INUTILE (et fait perdre
  les saisies faites entre-temps). Ne restaurer que si la base elle-même est corrompue.
  Exception à connaître : `0052` a **supprimé l'enum** `TypeIncident` au profit d'un
  référentiel en table ; un retour au code d'avant 0052 est donc à éviter — préférer corriger
  en avant. Les migrations 0043-0051 et 0053 n'ont pas cette contrainte.
- l'ancien APK redevient compatible avec l'ancien code : pas d'action mobile au rollback.
  **Mais** si l'API est revenue en arrière alors que le b34 est déjà distribué, les mobiles
  fonctionnent quand même (le b34 envoie les signatures, l'ancienne API les ignore).
- après tout retour arrière : diagnostiquer À FROID sur ce dépôt, jamais en direct en prod.

---

## Après la généralisation (rappels)

- Exercice de restauration complet chronométré sur une machine vierge (mesurer le vrai RTO).
- Supervision externe (ping + alerte) et traçage d'erreurs applicatif.
- Version minimale d'APK exigée par l'API (éviter les APK zombies à la prochaine rupture).
- Étendre la suite E2E (10 tests aujourd'hui + 2 setups : auth, session, transporteur,
  synthèses) aux
  parcours d'ÉCRITURE sur un environnement de test dédié (création BL, plan, clôture) — ils ne
  peuvent pas tourner contre la prod (SMS réels, données réelles).
- **Durcir la validation d'entrée** : les contrôleurs métier n'ont pas de schémas zod en amont
  (seuls `/auth` et `/admin/db` en ont). Le gestionnaire d'erreurs rattrape désormais toutes
  les entrées fautives en 4xx propres, mais des schémas dédiés restent le correctif de fond.
- **Arbitrage laissé ouvert** (audit du 27/08) : `GET /bons-commande` et `/bons-livraison`
  n'ont pas de garde de rôle — un technicien voit toute la logistique. Non restreint car le
  mobile terrain lit les BL ; à trancher.
- **Rapport « santé du parc solaire »** (production dans le temps, batteries en dérive,
  nettoyages) — demandé, non encore réalisé.
- **Fusion contacts / utilisateurs** : reportée après la bascule (l'alignement 1 clic depuis
  `/contacts/coherence` couvre le besoin immédiat).
