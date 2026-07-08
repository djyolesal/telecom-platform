import { prisma } from '../config/database';
import { getNum } from '../services/settings.service';
import { notificationService } from '../services/notifications.service';
import { logger } from '../utils/logger';

/**
 * Vidange GE conditionnée aux heures de marche : notifie les superviseurs
 * pour chaque GE en service dont l'index horaire a progressé d'au moins
 * `ge.intervalleVidangeHeures` (250 h par défaut) depuis la dernière vidange
 * confirmée. Les GE jamais vidangés (référence inconnue) sont ignorés : le
 * compteur démarre à la première vidange enregistrée.
 */
export async function vidangeAlertJob(): Promise<void> {
  const seuil = getNum('ge.intervalleVidangeHeures', 250);

  const groupes = await prisma.groupeElectrogene.findMany({
    where: { isActive: true, siteId: { not: null }, indexHeuresDerniereVidange: { not: null } },
    select: {
      id: true, numero: true, indexHeuresDerniereVidange: true,
      site: { select: { code: true, nom: true } },
    },
  });
  if (!groupes.length) return;

  // Dernier index horaire relevé par GE (relevés triés du plus récent au plus ancien).
  const releves = await prisma.releveEnergie.findMany({
    where: { source: 'GE', groupeId: { in: groupes.map((g) => g.id) }, indexHeuresGE: { not: null } },
    orderBy: { dateReleve: 'desc' },
    select: { groupeId: true, indexHeuresGE: true },
  });
  const dernierIndex = new Map<string, number>();
  for (const r of releves) {
    if (r.groupeId && !dernierIndex.has(r.groupeId)) dernierIndex.set(r.groupeId, Number(r.indexHeuresGE));
  }

  const dus = groupes
    .map((g) => ({
      g,
      heures: (dernierIndex.get(g.id) ?? Number(g.indexHeuresDerniereVidange)) - Number(g.indexHeuresDerniereVidange),
    }))
    .filter(({ heures }) => heures >= seuil);

  if (!dus.length) {
    logger.info('[vidange-alert] Aucun GE au seuil de vidange');
    return;
  }

  const liste = dus
    .slice(0, 10)
    .map(({ g, heures }) => `${g.site?.code ?? '?'} GE n°${g.numero} (${Math.round(heures)} h)`)
    .join(', ');
  await notificationService.sendToRole('SUPERVISEUR', {
    title: `🛢️ Vidange GE due — ${dus.length} groupe(s) ≥ ${seuil} h`,
    body: liste + (dus.length > 10 ? '…' : ''),
    data: { type: 'vidange_due' },
  });
  logger.info(`[vidange-alert] ${dus.length} GE au-delà de ${seuil} h notifiés`);
}
