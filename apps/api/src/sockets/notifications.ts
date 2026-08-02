import { Namespace, Socket } from 'socket.io';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';

interface AuthedSocket extends Socket {
  userId?: string;
}

/**
 * Handlers du namespace /notif. Les notifications sont poussées par
 * notificationService.sendToUser → io.of('/notif').to('user:<id>').
 */
export function registerNotificationHandlers(_ns: Namespace, socket: AuthedSocket) {
  // À la connexion, on renvoie le compteur de non-lues
  // Socket.IO n'attend NI ne rattrape les handlers async : une erreur Prisma
  // non capturée ici devient une unhandledRejection → arrêt du process Node.
  socket.on('notifications:unread-count', async () => {
    try {
      if (!socket.userId) return;
      const count = await prisma.notification.count({ where: { userId: socket.userId, isRead: false } });
      socket.emit('notifications:unread-count', { count });
    } catch (e) {
      logger.warn('[socket] unread-count échoué:', e);
    }
  });

  socket.on('notification:ack', async (id: string) => {
    if (!socket.userId || typeof id !== 'string') return;
    await prisma.notification
      .updateMany({ where: { id, userId: socket.userId }, data: { isRead: true } })
      .catch(() => undefined);
  });
}
