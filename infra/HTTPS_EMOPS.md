# Mise en HTTPS de emops.uk (Let's Encrypt)

Prérequis (déjà faits) : `emops.uk` et `www.emops.uk` pointent en A vers
41.78.137.83, en **DNS only** (nuage gris) chez Cloudflare. `certbot` est
installé sur le serveur (via `setup-server.sh`).

## 1. Première émission du certificat

À faire **une seule fois**, sur le serveur, dans `/opt/telecom/app` :

```bash
cd /opt/telecom/app
git pull                                  # récupère la nouvelle conf nginx + docker-compose

mkdir -p /opt/telecom/certbot-webroot     # webroot des renouvellements

# nginx occupe le port 80 → on le libère quelques secondes pour la validation
docker compose stop nginx
certbot certonly --standalone \
  -d emops.uk -d www.emops.uk \
  --non-interactive --agree-tos -m admin@emops.uk

# Le certificat existe maintenant dans /etc/letsencrypt/live/emops.uk/
# → on applique la nouvelle conf (server_name + montage /etc/letsencrypt)
docker compose up -d nginx
```

Vérification :

```bash
curl -I https://emops.uk/api/v1/config      # doit répondre (401 = API vivante, TLS valide)
docker compose logs nginx --tail 20         # aucun « cannot load certificate »
```

## 2. Renouvellement automatique (sans coupure)

Le certificat Let's Encrypt dure 90 jours. Remplacez la ligne certbot du cron
système (`/etc/cron.d/...`, posée par setup-server.sh) par un renouvellement
**webroot** (nginx reste en marche, il sert le challenge depuis `/var/www/certbot`) :

```
0 3 1,15 * * root certbot renew --webroot -w /opt/telecom/certbot-webroot --quiet \
  --deploy-hook "docker compose -f /opt/telecom/app/docker-compose.yml restart nginx" \
  >> /opt/telecom/logs/ssl.log 2>&1
```

Le montage `/etc/letsencrypt:ro` dans nginx fait que les fichiers renouvelés
sont vus immédiatement ; le `--deploy-hook` ne redémarre nginx que lorsqu'un
renouvellement a réellement eu lieu. Test à blanc : `certbot renew --dry-run`.

## 3. Applications

- **Mobile** : reconstruire l'APK **sans** `ALLOW_SELF_SIGNED` (le certificat est
  désormais valide) :
  ```bash
  flutter build apk --release --dart-define=API_URL=https://emops.uk/api/v1
  ```
  (`https://emops.uk/api/v1` est désormais l'URL par défaut du binaire.)
- **Web / API** : dans le `.env` du serveur, pointer les URLs publiques sur le
  domaine puis `docker compose up -d web api` :
  ```
  APP_URL=https://emops.uk
  NEXTAUTH_URL=https://emops.uk
  CORS_ORIGIN=https://emops.uk
  ```

## 4. (Option) Proxy Cloudflare + protection DDoS

Une fois le HTTPS opérationnel, vous pouvez repasser les enregistrements A en
**Proxied** (nuage orange) : l'IP réelle du serveur est masquée et vous
bénéficiez de la protection DDoS gratuite. Le renouvellement continue de
fonctionner (méthode webroot, port 80 servi par nginx derrière Cloudflare).
Réglez alors le mode SSL Cloudflare sur **Full (strict)**.

## 5. Incident du 10/10/2026 : erreur Cloudflare 526 (certificat expiré)

**Cause.** Le certificat émis le 12/07 en mode `--standalone` expirait le 10/10.
Le cron posé par `setup-server.sh` lançait `certbot renew` sans méthode : certbot
rejoue alors celle de la première émission (standalone), qui exige le port 80
libre - or nginx l'occupe en permanence. Chaque renouvellement échouait en
silence (voir `/opt/telecom/logs/ssl.log`). Avec le proxy Cloudflare en mode
**Full (strict)**, un certificat d'origine expiré donne la page « Error 526 ».

**Rétablir.**
1. Cloudflare → SSL/TLS → mode **Full** (temporairement) : le site revient tout
   de suite (chiffré, certificat d'origine non vérifié), et le challenge ACME
   passe même si « Always Use HTTPS » redirige vers https.
2. Sur le serveur : `sudo certbot renew --webroot -w /opt/telecom/certbot-webroot`
   (ce passage enregistre aussi la méthode webroot pour les renouvellements
   suivants), puis `docker compose restart nginx`.
3. Remplacer la ligne certbot de `/etc/crontab` par celle du paragraphe 2, et
   tester : `sudo certbot renew --dry-run`.
4. Cloudflare → SSL/TLS → repasser en **Full (strict)**.
