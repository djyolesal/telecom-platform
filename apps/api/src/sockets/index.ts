import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { redisClient } from '../config/redis';
import { sessionValide, Plateforme } from '../services/session.service';
import { registerSupervisionHandlers } from './supervision';
import { registerNotificationHandlers } from './notifications';

interface AuthedSocket extends Socket {
  userId?: string;
  role?: string;
}

// Le flux supervision (incidents live, alertes stock avec codes sites +
// autonomie) est un canal d'EXPLOITATION : les rôles terrain (technicien,
// transporteur — comptes externes) n'ont pas à le recevoir. Ils passent par
// /notif (room par utilisateur) pour leurs propres notifications.
const ROLES_SUPERVISION = new Set(['SUPERVISEUR', 'MANAGER', 'DIRECTION', 'ADMIN', 'NOC']);

/**
 * Authentifie une connexion socket via le JWT, et REVÉRIFIE l'état de la
 * session — sinon un jeton révoqué (déconnexion, session remplacée sur un autre
 * appareil, compte désactivé) gardait sa connexion persistante bien au-delà de
 * l'expiration. `rolesAutorises` restreint en plus l'accès d'un namespace.
 */
function faireAuthSocket(rolesAutorises?: Set<string>) {
  return async (socket: AuthedSocket, next: (err?: Error) => void) => {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];
    if (!token) return next(new Error('Token manquant'));
    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as { sub: string; role: string; sid?: string; plt?: Plateforme };
      // Jeton explicitement blacklisté (déconnexion) ?
      if (await redisClient.get(`blacklist:${token}`)) return next(new Error('Token révoqué'));
      // Session encore la session courante de cette plateforme ? (révocation,
      // login plus récent ailleurs, compte désactivé → sessions effacées).
      if (!payload.sid || !payload.plt || !(await sessionValide(payload.sub, payload.plt, payload.sid))) {
        return next(new Error('Session invalide'));
      }
      if (rolesAutorises && !rolesAutorises.has(payload.role)) return next(new Error('Accès refusé'));
      socket.userId = payload.sub;
      socket.role = payload.role;
      next();
    } catch {
      next(new Error('Token invalide'));
    }
  };
}

export function setupSocketIO(io: SocketIOServer): void {
  // ── Namespace supervision (carte, incidents live, alertes stock) ──
  const supervision = io.of('/supervision');
  supervision.use(faireAuthSocket(ROLES_SUPERVISION));
  supervision.on('connection', (socket: AuthedSocket) => {
    logger.debug(`[socket] supervision connecté: ${socket.userId}`);
    if (socket.role) socket.join(`role:${socket.role}`);
    registerSupervisionHandlers(supervision, socket);
    socket.on('disconnect', () => logger.debug(`[socket] supervision déconnecté: ${socket.userId}`));
  });

  // ── Namespace notifications (room par utilisateur) ──
  const notif = io.of('/notif');
  notif.use(faireAuthSocket());
  notif.on('connection', (socket: AuthedSocket) => {
    if (socket.userId) socket.join(`user:${socket.userId}`);
    registerNotificationHandlers(notif, socket);
    socket.on('disconnect', () => logger.debug(`[socket] notif déconnecté: ${socket.userId}`));
  });

  logger.info('✅ Socket.IO namespaces /supervision et /notif initialisés');
}
