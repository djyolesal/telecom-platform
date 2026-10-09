/**
 * Filtre « zone de maintenance » d'une liste, sur le site : `zone_id=<id>`, ou
 * `zone_id=aucune` pour les sites sans zone (ceux que l'import n'a pas couverts).
 * Clause Prisma sur Site ; pour une liste dont le site est une relation
 * (incidents, coupures, maintenances), la poser sous `site`.
 */
export function filtreZone(zoneId: unknown): { zoneMaintenanceId?: string | null } {
  const v = typeof zoneId === 'string' ? zoneId.trim() : '';
  if (!v) return {};
  return { zoneMaintenanceId: v === 'aucune' ? null : v };
}
