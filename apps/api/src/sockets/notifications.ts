import { Namespace, Socket } from 'socket.io';
import { prisma } from '../config/database';

interface AuthedSocket extends Socket {
  userId?: string;
}

/**
 * Handlers du namespace /notif. Les notifications sont poussées par
 * notificationService.sendToUser → io.of('/notif').to('user:<id>').
 */
export function registerNotificationHandlers(_ns: Namespace, socket: AuthedSocket) {
  // À la connexion, on renvoie le compteur de non-lues
  socket.on('notifications:unread-count', async () => {
    if (!socket.userId) return;
    const count = await prisma.notification.count({ where: { userId: socket.userId, isRead: false } });
    socket.emit('notifications:unread-count', { count });
  });

  socket.on('notification:ack', async (id: string) => {
    if (!socket.userId || typeof id !== 'string') return;
    await prisma.notification
      .updateMany({ where: { id, userId: socket.userId }, data: { isRead: true } })
      .catch(() => undefined);
  });
}
