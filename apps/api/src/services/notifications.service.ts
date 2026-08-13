import { readFileSync } from 'fs';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export interface NotificationPayload {
  title: string;
  body: string;
  type?: string;
  data?: Record<string, unknown>;
}

/** Émet l'événement temps réel via Socket.IO (import paresseux pour éviter le cycle). */
function emitToUser(userId: string, payload: NotificationPayload & { id: string }) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { io } = require('../server') as typeof import('../server');
    io.of('/notif').to(`user:${userId}`).emit('notification:new', payload);
  } catch (err) {
    logger.warn('Émission socket notification échouée:', err);
  }
}

// ── Push FCM (API HTTP v1) ──────────────────────────────────────────────────
// L'API legacy (clé serveur) est coupée par Google depuis juin 2024 : la v1
// s'authentifie par compte de service (OAuth 2.0, assertion JWT RS256).

interface CompteServiceFirebase { project_id: string; client_email: string; private_key: string }

let compteService: CompteServiceFirebase | null | undefined; // undefined = pas encore lu
function chargerCompteService(): CompteServiceFirebase | null {
  if (compteService !== undefined) return compteService;
  compteService = null;
  const brut = env.FIREBASE_SERVICE_ACCOUNT;
  if (!brut) return compteService; // push non configuré : silencieux, canaux socket/in-app suffisent
  try {
    const contenu = brut.trim().startsWith('{') ? brut : readFileSync(brut, 'utf8');
    const j = JSON.parse(contenu) as Partial<CompteServiceFirebase>;
    if (j.project_id && j.client_email && j.private_key) {
      compteService = j as CompteServiceFirebase;
      logger.info(`Push FCM v1 actif (projet ${j.project_id})`);
    } else logger.warn('FIREBASE_SERVICE_ACCOUNT incomplet : project_id, client_email et private_key requis');
  } catch (err) {
    logger.warn('FIREBASE_SERVICE_ACCOUNT illisible :', err);
  }
  return compteService;
}

let jetonOauth: { valeur: string; expireA: number } | null = null;
async function obtenirJetonOauth(cs: CompteServiceFirebase): Promise<string | null> {
  if (jetonOauth && Date.now() < jetonOauth.expireA - 60_000) return jetonOauth.valeur;
  const maintenant = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    {
      iss: cs.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: maintenant,
      exp: maintenant + 3600,
    },
    cs.private_key,
    { algorithm: 'RS256' }
  );
  const rep = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${assertion}`,
  });
  if (!rep.ok) {
    logger.warn(`OAuth Firebase refusé (${rep.status})`);
    return null;
  }
  const j = (await rep.json()) as { access_token: string; expires_in: number };
  jetonOauth = { valeur: j.access_token, expireA: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

/** Envoi push FCM v1 — best-effort, ne bloque jamais la chaîne de dispatch. */
async function sendFcm(token: string, payload: NotificationPayload): Promise<void> {
  const cs = chargerCompteService();
  if (!cs || !token) return;
  try {
    const oauth = await obtenirJetonOauth(cs);
    if (!oauth) return;
    const rep = await fetch(`https://fcm.googleapis.com/v1/projects/${cs.project_id}/messages:send`, {
      method: 'POST',
      // Sans signal, undici attend 300 s : un FCM injoignable figeait la boucle
      // de dispatch des incidents pendant 5 minutes.
      signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${oauth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: payload.title, body: payload.body },
          // La v1 exige des data à valeurs STRING.
          data: Object.fromEntries(Object.entries(payload.data ?? {}).map(([k, v]) => [k, String(v)])),
          android: { priority: 'high' },
        },
      }),
    });
    if (!rep.ok) {
      const corps = await rep.text().catch(() => '');
      if (rep.status === 404 || corps.includes('UNREGISTERED')) {
        // Jeton mort (app désinstallée / réinstallée) : on le purge pour ne
        // plus le solliciter — l'app en re-déclarera un à la prochaine session.
        await prisma.user.updateMany({ where: { fcmToken: token }, data: { fcmToken: null } });
      } else {
        logger.warn(`Échec push FCM v1 (${rep.status}) : ${corps.slice(0, 200)}`);
      }
    }
  } catch (err) {
    logger.warn('Échec push FCM :', err);
  }
}

async function persistAndDispatch(userId: string, payload: NotificationPayload, fcmTokenConnu?: string | null) {
  const notif = await prisma.notification.create({
    data: {
      userId,
      type: payload.type ?? 'GENERAL',
      title: payload.title,
      body: payload.body,
      data: payload.data ? (payload.data as object) : undefined,
    },
  });

  emitToUser(userId, { ...payload, id: notif.id });

  // fcmToken déjà chargé par l'appelant (sendToRole) → pas de requête par
  // destinataire (N+1). Sinon on le récupère (envoi à un utilisateur isolé).
  const token = fcmTokenConnu !== undefined ? fcmTokenConnu
    : (await prisma.user.findUnique({ where: { id: userId }, select: { fcmToken: true } }))?.fcmToken ?? null;
  if (token) await sendFcm(token, payload);

  return notif;
}

export const notificationService = {
  /** Notifie un utilisateur précis. */
  async sendToUser(userId: string, payload: NotificationPayload) {
    return persistAndDispatch(userId, payload);
  },

  /** Notifie tous les utilisateurs actifs d'un rôle donné. */
  async sendToRole(role: string, payload: NotificationPayload) {
    const users = await prisma.user.findMany({
      where: { role: role as never, isActive: true },
      select: { id: true, fcmToken: true },
    });
    await Promise.all(users.map((u) => persistAndDispatch(u.id, payload, u.fcmToken)));
    return users.length;
  },

  /** Notifie tous les utilisateurs d'un rôle dans une région. */
  async sendToRoleInRegion(role: string, region: string, payload: NotificationPayload) {
    const users = await prisma.user.findMany({
      where: { role: role as never, region, isActive: true },
      select: { id: true, fcmToken: true },
    });
    await Promise.all(users.map((u) => persistAndDispatch(u.id, payload, u.fcmToken)));
    return users.length;
  },
};
