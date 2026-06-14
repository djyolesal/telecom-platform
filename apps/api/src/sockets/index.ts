import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { registerSupervisionHandlers } from './supervision';
import { registerNotificationHandlers } from './notifications';

interface AuthedSocket extends Socket {
  userId?: string;
  role?: string;
}

/** Authentifie une connexion socket via le JWT passé dans handshake.auth.token. */
function authSocket(socket: AuthedSocket, next: (err?: Error) => void) {
  const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];
  if (!token) return next(new Error('Token manquant'));
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as { sub: string; role: string };
    socket.userId = payload.sub;
    socket.role = payload.role;
    next();
  } catch {
    next(new Error('Token invalide'));
  }
}

export function setupSocketIO(io: SocketIOServer): void {
  // ── Namespace supervision (carte, incidents live, alertes stock) ──
  const supervision = io.of('/supervision');
  supervision.use(authSocket);
  supervision.on('connection', (socket: AuthedSocket) => {
    logger.debug(`[socket] supervision connecté: ${socket.userId}`);
    if (socket.role) socket.join(`role:${socket.role}`);
    registerSupervisionHandlers(supervision, socket);
    socket.on('disconnect', () => logger.debug(`[socket] supervision déconnecté: ${socket.userId}`));
  });

  // ── Namespace notifications (room par utilisateur) ──
  const notif = io.of('/notif');
  notif.use(authSocket);
  notif.on('connection', (socket: AuthedSocket) => {
    if (socket.userId) socket.join(`user:${socket.userId}`);
    registerNotificationHandlers(notif, socket);
    socket.on('disconnect', () => logger.debug(`[socket] notif déconnecté: ${socket.userId}`));
  });

  logger.info('✅ Socket.IO namespaces /supervision et /notif initialisés');
}
