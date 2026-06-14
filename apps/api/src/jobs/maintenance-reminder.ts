import { startOfDay, endOfDay, addDays } from 'date-fns';
import { prisma } from '../config/database';
import { notificationService } from '../services/notifications.service';
import { logger } from '../utils/logger';

/**
 * Rappelle aux techniciens les maintenances préventives planifiées pour aujourd'hui
 * et demain (statut PLANIFIEE).
 */
export async function maintenanceReminderJob(): Promise<void> {
  const debut = startOfDay(new Date());
  const fin = endOfDay(addDays(new Date(), 1));

  const maintenances = await prisma.maintenance.findMany({
    where: { statut: 'PLANIFIEE', datePlanifiee: { gte: debut, lte: fin }, technicienId: { not: null } },
    include: { site: { select: { code: true, nom: true } } },
  });

  if (!maintenances.length) {
    logger.info('[maintenance-reminder] Aucune maintenance à rappeler');
    return;
  }

  // Regrouper par technicien
  const parTech = new Map<string, typeof maintenances>();
  for (const m of maintenances) {
    if (!m.technicienId) continue;
    const arr = parTech.get(m.technicienId) ?? [];
    arr.push(m);
    parTech.set(m.technicienId, arr);
  }

  for (const [technicienId, list] of parTech) {
    await notificationService.sendToUser(technicienId, {
      type: 'MAINTENANCE_REMINDER',
      title: `🔧 ${list.length} maintenance(s) planifiée(s)`,
      body: list.map((m) => `${m.site?.code} — ${m.equipement}`).join(', ').slice(0, 250),
      data: { kind: 'maintenance_reminder' },
    });
  }

  logger.info(`[maintenance-reminder] ${parTech.size} technicien(s) notifié(s)`);
}
