import { prisma } from '../config/database';
import { L_NIVEAU_STOCK, libelle } from '../utils/libelles';
import { calculerStockSite } from '../utils/calculator';
import { geParams } from '../services/settings.service';
import { notificationService } from '../services/notifications.service';
import { logger } from '../utils/logger';
import { stockEtDates } from '../services/stockCourant.service';

/**
 * Vérifie le stock de carburant de chaque site et notifie les superviseurs
 * pour les sites dont l'autonomie est critique ou faible. Émet aussi
 * l'événement stock:alert sur le namespace supervision.
 */
export async function stockAlertJob(): Promise<void> {
  const sites = await prisma.site.findMany({ where: { isActive: true } });

  // Même stock que la page « Stock carburant » et le tableau de bord (source
  // unique) : dernière mesure - relevé ou jauge après livraison - + dépotages
  // et mouvements postérieurs. Ce job en gardait une copie qui ignorait les
  // jauges de dépotage et les transferts.
  const { stock: stockMap } = await stockEtDates();

  const alertes = sites
    // Un site JAMAIS relevé (aucun stock connu) ne doit pas générer un faux
    // « VIDE » quotidien : on ne l'évalue que si une mesure de cuve existe.
    .filter((site) => stockMap.has(site.id))
    .map((site) => ({ site, stock: calculerStockSite(site, { volumeGasoilLitres: stockMap.get(site.id)! }, geParams()) }))
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
      title: `⛽ ${list.length} site(s) en alerte carburant - ${region}`,
      body: list.map((a) => `${a.site.nom} (${libelle(L_NIVEAU_STOCK, a.stock.niveauAlerte)})`).join(', ').slice(0, 250),
      data: { kind: 'stock_alert', region },
    });
  }

  logger.info(`[stock-alert] ${alertes.length} alertes envoyées`);
}
