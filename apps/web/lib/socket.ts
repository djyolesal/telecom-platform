import { io, type Socket } from 'socket.io-client';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || '';

const sockets: Record<string, Socket> = {};

/**
 * Retourne (en le créant si besoin) un socket connecté à un namespace,
 * authentifié via le token JWT de la session.
 */
export function getSocket(namespace: '/supervision' | '/notif', token?: string): Socket {
  if (sockets[namespace]?.connected) return sockets[namespace];

  const socket = io(`${WS_URL}${namespace}`, {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    auth: { token },
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: 10,
  });

  sockets[namespace] = socket;
  return socket;
}

export function disconnectSocket(namespace: '/supervision' | '/notif'): void {
  sockets[namespace]?.disconnect();
  delete sockets[namespace];
}
