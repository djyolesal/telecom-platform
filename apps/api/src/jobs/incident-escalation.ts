import { differenceInMinutes } from 'date-fns';
import { L_SEVERITE, libelle } from '../utils/libelles';
import { prisma } from '../config/database';
import { notificationService } from '../services/notifications.service';
import { logger } from '../utils/logger';
import { getNum } from '../services/settings.service';

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

/**
 * Filet de durée sur les coupures PARTIELLES : une panne partielle ouverte
 * depuis plus de `coupure.escaladePartielleHeures` sans incident est envoyée au
 * terrain (incident MAJEUR + notification), comme l'armement automatique le
 * fait pour les coupures SITE. 0 = désactivé, l'escalade reste alors manuelle.
 * Les héritées (impact aval) sont exclues : le travail est sur le site amont.
 */
async function escaladerPartiellesMures(): Promise<number> {
  const heures = getNum('coupure.escaladePartielleHeures', 0);
  if (heures <= 0) return 0;
  const { declencherTerrainRacine } = await import('../controllers/coupuresReseau.controller');
  const limite = new Date(Date.now() - heures * 3_600_000);
  const mures = await prisma.coupureReseau.findMany({
    where: {
      technologie: { not: 'SITE' }, origine: 'LOCALE',
      dateFin: null, incidentId: null, dateDebut: { lte: limite },
    },
    select: { id: true, siteId: true },
  });
  let escalades = 0;
  for (const c of mures) {
    try {
      const info = await declencherTerrainRacine(c.id, { nom: 'AUTO-DURÉE', declarePar: null });
      if (info) escalades++;
    } catch (e) {
      logger.warn('[escalation] escalade partielle échouée pour', c.id, e);
    }
  }
  if (escalades) logger.info(`[escalation] ${escalades} coupure(s) partielle(s) escaladée(s) au terrain (> ${heures} h)`);
  return escalades;
}

export async function incidentEscalationJob(): Promise<void> {
  // D'abord le filet de durée : une partielle qui vient d'être escaladée
  // entrera dans la boucle d'escalade managers au passage suivant.
  try { await escaladerPartiellesMures(); } catch (e) { logger.error('[escalation] filet partielles:', e); }

  const ouverts = await prisma.incident.findMany({
    where: { statut: 'OUVERT' },
    include: { site: { select: { nom: true, code: true, region: true } } },
  });

  const now = new Date();
  let escalades = 0;

  for (const inc of ouverts) {
    const sla = SLA_MINUTES[inc.severite] ?? 240;
    const age = differenceInMinutes(now, inc.dateOuverture);
    if (age < sla) continue;

    await notificationService.sendToRoleInRegion('MANAGER', inc.site.region, {
      type: 'INCIDENT_ESCALATION',
      title: `⚠️ Escalade incident ${libelle(L_SEVERITE, inc.severite)} - ${inc.site.nom}`,
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
