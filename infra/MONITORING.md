# Monitoring & alertes

Stack : Prometheus (collecte) + node-exporter (métriques hôte) + Alertmanager
(notifications email) + Grafana (visualisation). Objectif : **être prévenu**
d'une panne (disque plein, API down, mémoire saturée) au lieu de la découvrir
par les techniciens terrain.

## Mise en route (une fois, sur le serveur)

Alertmanager envoie les emails via Brevo (déjà configuré pour l'app). Deux
valeurs à renseigner :

1. **Login SMTP Brevo** dans `infra/alertmanager/alertmanager.yml`
   (`smtp_auth_username`) — remplacer `REMPLACER_PAR_LOGIN_SMTP_BREVO`.
2. **Mot de passe SMTP Brevo** dans un fichier de secret (non versionné) :
   ```bash
   mkdir -p /opt/telecom/secrets
   printf '%s' 'CLE_SMTP_BREVO' > /opt/telecom/secrets/alertmanager-smtp-password
   chmod 600 /opt/telecom/secrets/alertmanager-smtp-password
   ```
3. Adresse(s) destinataire des alertes : `to:` dans `alertmanager.yml`
   (par défaut `mindhirou@gmail.com`).

Puis démarrer les nouveaux services :
```bash
docker compose up -d node-exporter alertmanager prometheus grafana
docker compose ps        # les 4 doivent être Up
```

## Vérifier

- **Prometheus** (tunnel SSH) `http://localhost:9090/targets` → toutes les cibles
  `UP` (api, node, prometheus). Plus de cibles fantômes.
- **Prometheus** `/alerts` → règles chargées (aucune active si tout va bien).
- **Grafana** `https://emops.uk/grafana` → dashboards « API — Vue d'ensemble » et
  « Infrastructure — Santé serveur » (disque, RAM, CPU, services up) avec données.
- **Test d'alerte** : abaisser temporairement le seuil disque à `> 0.01` dans
  `alerts.yml`, `docker compose restart prometheus`, attendre 5 min → email reçu.
  Remettre `0.80` ensuite.

## Alertes configurées

| Alerte | Seuil | Sévérité |
|--------|-------|----------|
| Disque bientôt plein | > 80 % pendant 10 min | warning |
| Disque presque saturé | > 92 % pendant 5 min | critical |
| Mémoire haute | > 90 % pendant 10 min | warning |
| API injoignable | up=0 pendant 3 min | critical |
| Sonde hôte injoignable | up=0 pendant 5 min | warning |

Rappel toutes les 6 h tant qu'une alerte dure ; email « resolved » à la fin.
