import { Namespace, Socket } from 'socket.io';

/**
 * Handlers du namespace /supervision.
 * Les événements sortants (incident:created, stock:alert, ...) sont émis depuis les
 * contrôleurs et les jobs ; ici on gère les abonnements entrants des clients web.
 */
export function registerSupervisionHandlers(_ns: Namespace, socket: Socket) {
  // Abonnement à une région précise pour filtrer les mises à jour
  socket.on('subscribe:region', (region: string) => {
    if (typeof region === 'string') socket.join(`region:${region}`);
  });

  socket.on('unsubscribe:region', (region: string) => {
    if (typeof region === 'string') socket.leave(`region:${region}`);
  });

  // Ping de présence pour la carte temps réel
  socket.on('ping:presence', () => socket.emit('pong:presence', { ts: Date.now() }));
}
