'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket } from '@/lib/socket';

export interface SupervisionEvents {
  onIncidentCreated?: (data: unknown) => void;
  onIncidentUpdated?: (data: unknown) => void;
  onStockAlert?: (data: unknown) => void;
}

/**
 * S'abonne au namespace /supervision et invalide les requêtes pertinentes
 * (dashboard, incidents, carte) lors des événements temps réel.
 */
export function useSupervisionSocket(handlers: SupervisionEvents = {}) {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const token = (session as { accessToken?: string } | null)?.accessToken;

  useEffect(() => {
    if (!token) return;
    const socket = getSocket('/supervision', token);

    const invalidate = (keys: string[]) =>
      keys.forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));

    const onCreated = (d: unknown) => { handlers.onIncidentCreated?.(d); invalidate(['dashboard', 'incidents', 'sites-geojson']); };
    const onUpdated = (d: unknown) => { handlers.onIncidentUpdated?.(d); invalidate(['dashboard', 'incidents']); };
    const onResolved = () => invalidate(['dashboard', 'incidents']);
    const onStockAlert = (d: unknown) => { handlers.onStockAlert?.(d); invalidate(['dashboard', 'stock']); };
    const onStockUpdated = () => invalidate(['dashboard', 'stock', 'sites-geojson']);

    socket.on('incident:created', onCreated);
    socket.on('incident:updated', onUpdated);
    socket.on('incident:resolved', onResolved);
    socket.on('incident:escalated', onUpdated);
    socket.on('stock:alert', onStockAlert);
    socket.on('stock:updated', onStockUpdated);

    return () => {
      socket.off('incident:created', onCreated);
      socket.off('incident:updated', onUpdated);
      socket.off('incident:resolved', onResolved);
      socket.off('incident:escalated', onUpdated);
      socket.off('stock:alert', onStockAlert);
      socket.off('stock:updated', onStockUpdated);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
}
