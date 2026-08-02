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

/** Envoi push FCM (legacy HTTP API) — best-effort. */
async function sendFcm(token: string, payload: NotificationPayload): Promise<void> {
  if (!env.FCM_SERVER_KEY || !token) return;
  try {
    await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      // Sans signal, undici attend 300 s : un FCM injoignable figeait la boucle
      // de dispatch des incidents pendant 5 minutes.
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `key=${env.FCM_SERVER_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: token,
        notification: { title: payload.title, body: payload.body },
        data: payload.data ?? {},
      }),
    });
  } catch (err) {
    logger.warn('Échec push FCM:', err);
  }
}

async function persistAndDispatch(userId: string, payload: NotificationPayload) {
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

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { fcmToken: true },
  });
  if (user?.fcmToken) await sendFcm(user.fcmToken, payload);

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
      select: { id: true },
    });
    await Promise.all(users.map((u) => persistAndDispatch(u.id, payload)));
    return users.length;
  },

  /** Notifie tous les utilisateurs d'un rôle dans une région. */
  async sendToRoleInRegion(role: string, region: string, payload: NotificationPayload) {
    const users = await prisma.user.findMany({
      where: { role: role as never, region, isActive: true },
      select: { id: true },
    });
    await Promise.all(users.map((u) => persistAndDispatch(u.id, payload)));
    return users.length;
  },
};
