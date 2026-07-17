import { io, type Socket } from 'socket.io-client';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || '';

const sockets: Record<string, Socket> = {};

/**
 * Retourne (en le créant si besoin) un socket connecté à un namespace,
 * authentifié via le token JWT de la session.
 */
export function getSocket(namespace: '/supervision' | '/notif', token?: string): Socket {
  // Réutiliser le socket EXISTANT même s'il est en cours de reconnexion (état
  // `connected=false` transitoire) : sinon chaque rendu en créait un nouveau et
  // orphelinait l'ancien (événements dupliqués, sockets fantômes).
  const existing = sockets[namespace];
  if (existing) {
    // Rafraîchit le jeton d'auth pour les reconnexions (le JWT expire à 12 h).
    if (token) existing.auth = { token };
    return existing;
  }

  const socket = io(`${WS_URL}${namespace}`, {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    auth: { token },
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelayMax: 15_000,
  });

  sockets[namespace] = socket;
  return socket;
}

export function disconnectSocket(namespace: '/supervision' | '/notif'): void {
  sockets[namespace]?.disconnect();
  delete sockets[namespace];
}
