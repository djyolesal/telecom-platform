# Envoi d'emails depuis emops.uk

L'application envoie déjà des emails transactionnels (réinitialisation de mot de
passe, alertes, rapport mensuel) via SMTP (nodemailer). Il ne reste qu'à
brancher un service d'envoi et à authentifier le domaine. **Envoi uniquement** —
pas besoin d'héberger un serveur mail.

## 1. Service d'envoi (recommandé : Brevo, 300 mails/jour gratuits)

1. Créer un compte sur brevo.com.
2. **Senders, Domains & Dedicated IPs → Domains → Add a domain** → `emops.uk`.
3. Brevo affiche des enregistrements DNS (SPF, DKIM, DMARC) à ajouter.

## 2. Enregistrements DNS (dans Cloudflare, comme le A record)

Ajouter tels que fournis par Brevo — exemples de forme (les valeurs exactes
viennent de Brevo, ne pas inventer) :

| Type | Nom | Valeur | Note |
|------|-----|--------|------|
| TXT | `emops.uk` | `v=spf1 include:spf.brevo.com ~all` | SPF : autorise Brevo |
| TXT | `brevo._domainkey.emops.uk` | (clé DKIM fournie) | DKIM : signature |
| TXT | `_dmarc.emops.uk` | `v=DMARC1; p=quarantine; rua=mailto:contact@emops.uk` | DMARC : politique |

Les TXT ne sont jamais affectés par le proxy Cloudflare (nuage orange).
Attendre la coche « verified » chez Brevo (quelques minutes à 1 h).

## 3. Clés SMTP + configuration serveur

Dans Brevo : **SMTP & API → SMTP** → récupérer login + clé SMTP.
Renseigner le `.env` du serveur puis redémarrer l'API :

```
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=<login SMTP Brevo>
SMTP_PASS=<clé SMTP Brevo>
SMTP_FROM=E&M OpS <noreply@emops.uk>
SMTP_REPLY_TO=contact@emops.uk        # optionnel
```

```bash
docker compose up -d api
```

## 4. Vérifier (sans attendre un vrai reset)

Endpoint admin dédié — envoie un email de test à soi-même :

```bash
# TOKEN = jeton d'un compte ADMIN
curl -sk -X POST https://emops.uk/api/v1/admin/test-email \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"to":"votre.adresse@gmail.com"}'
```

Réponse `success:true` = SMTP OK. Vérifier la réception **hors spam** (si spam :
SPF/DKIM pas encore propagés ou mal copiés). Tester la délivrabilité sur
mail-tester.com donne un score /10.

## 5. (Option) Recevoir des mails @emops.uk

Brevo n'envoie que. Pour recevoir (ex. les réponses à `noreply@`, ou une adresse
`contact@emops.uk`), activer **Cloudflare Email Routing** (gratuit) : il pose un
MX et **redirige** les mails reçus vers une boîte existante (Gmail…), sans
serveur mail. Compatible avec Brevo (l'un envoie, l'autre reçoit).
