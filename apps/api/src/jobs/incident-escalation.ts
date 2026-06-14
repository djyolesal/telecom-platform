import { differenceInMinutes } from 'date-fns';
import { prisma } from '../config/database';
import { notificationService } from '../services/notifications.service';
import { logger } from '../utils/logger';

/**
 * Escalade les incidents ouverts non pris en charge au-delà d'un délai SLA
 * dépendant de la sévérité. Notifie les MANAGER de la région concernée.
 */
const SLA_MINUTES: Record<string, number> = {
  CRITIQUE: 30,
  MAJEUR: 120,
  MINEUR: 480,
  INFORMATIF: 1440,
};

export async function incidentEscalationJob(): Promise<void> {
  const ouverts = await prisma.incident.findMany({
    where: { statut: 'OUVERT' },
    include: { site: { select: { code: true, region: true } } },
  });

  const now = new Date();
  let escalades = 0;

  for (const inc of ouverts) {
    const sla = SLA_MINUTES[inc.severite] ?? 240;
    const age = differenceInMinutes(now, inc.dateOuverture);
    if (age < sla) continue;

    await notificationService.sendToRoleInRegion('MANAGER', inc.site.region, {
      type: 'INCIDENT_ESCALATION',
      title: `⚠️ Escalade incident ${inc.severite} — ${inc.site.code}`,
      body: `Incident ouvert depuis ${Math.round(age / 60)}h sans prise en charge : ${inc.description.slice(0, 120)}`,
      data: { kind: 'incident_escalation', incidentId: inc.id },
    });

    try {
      const { io } = require('../server') as typeof import('../server');
      io.of('/supervision').emit('incident:escalated', {
        id: inc.id, severite: inc.severite, siteCode: inc.site.code, ageMinutes: age,
      });
    } catch (e) {
      logger.warn('[escalation] socket émission échouée:', e);
    }
    escalades++;
  }

  logger.info(`[incident-escalation] ${escalades} incident(s) escaladé(s) sur ${ouverts.length} ouvert(s)`);
}
