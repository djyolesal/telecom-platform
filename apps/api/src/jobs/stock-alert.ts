import { prisma } from '../config/database';
import { calculerStockSite } from '../utils/calculator';
import { geParams } from '../services/settings.service';
import { notificationService } from '../services/notifications.service';
import { logger } from '../utils/logger';

/**
 * Vérifie le stock de carburant de chaque site et notifie les superviseurs
 * pour les sites dont l'autonomie est critique ou faible. Émet aussi
 * l'événement stock:alert sur le namespace supervision.
 */
export async function stockAlertJob(): Promise<void> {
  const sites = await prisma.site.findMany({ where: { isActive: true } });

  // Dernier niveau de cuve relevé par site (+ date, pour rejouer les dépotages postérieurs)
  const releves = await prisma.releveEnergie.findMany({
    where: { source: 'GE', volumeGasoilLitres: { not: null } },
    orderBy: { dateReleve: 'desc' },
    select: { siteId: true, volumeGasoilLitres: true, dateReleve: true },
  });
  const stockMap = new Map<string, number>();
  const dateMap = new Map<string, Date>();
  for (const r of releves) {
    if (!stockMap.has(r.siteId)) { stockMap.set(r.siteId, Number(r.volumeGasoilLitres)); dateMap.set(r.siteId, r.dateReleve); }
  }

  // Dépotages postérieurs au dernier relevé → cuve réapprovisionnée (cohérent avec le forecast).
  const depots = await prisma.depotage.findMany({ select: { siteId: true, dateDepotage: true, volumeLitres: true } });
  const depotMap = new Map<string, number>();
  for (const d of depots) {
    const ref = dateMap.get(d.siteId);
    if (ref && d.dateDepotage > ref) depotMap.set(d.siteId, (depotMap.get(d.siteId) ?? 0) + Number(d.volumeLitres));
  }

  const alertes = sites
    .map((site) => ({ site, stock: calculerStockSite(site, { volumeGasoilLitres: (stockMap.get(site.id) ?? 0) + (depotMap.get(site.id) ?? 0) }, geParams()) }))
    .filter(({ stock }) => ['CRITIQUE', 'VIDE'].includes(stock.niveauAlerte));

  if (!alertes.length) {
    logger.info('[stock-alert] Aucun site en alerte');
    return;
  }

  // Émission temps réel
  try {
    const { io } = require('../server') as typeof import('../server');
    io.of('/supervision').emit('stock:alert', {
      count: alertes.length,
      sites: alertes.map((a) => ({ code: a.site.code, niveau: a.stock.niveauAlerte, autonomieJours: a.stock.autonomieJours })),
    });
  } catch (e) {
    logger.warn('[stock-alert] socket émission échouée:', e);
  }

  // Notifications ciblées par région
  const parRegion = new Map<string, typeof alertes>();
  for (const a of alertes) {
    const arr = parRegion.get(a.site.region) ?? [];
    arr.push(a);
    parRegion.set(a.site.region, arr);
  }

  for (const [region, list] of parRegion) {
    await notificationService.sendToRoleInRegion('SUPERVISEUR', region, {
      type: 'STOCK_ALERT',
      title: `⛽ ${list.length} site(s) en alerte carburant — ${region}`,
      body: list.map((a) => `${a.site.code} (${a.stock.niveauAlerte})`).join(', ').slice(0, 250),
      data: { kind: 'stock_alert', region },
    });
  }

  logger.info(`[stock-alert] ${alertes.length} alertes envoyées`);
}
