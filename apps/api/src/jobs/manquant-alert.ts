import { computeManquants } from '../services/manquants.service';
import { notificationService } from '../services/notifications.service';
import { logger } from '../utils/logger';

/**
 * Détecte les manquants de livraison persistants (lignes non soldées au-delà du
 * délai) et notifie les managers. S'appuie sur le même calcul que le rapport.
 */
export async function manquantAlertJob(): Promise<void> {
  const m = await computeManquants({}); // année courante par défaut
  const enRetard = m.lignesEnRetard;

  if (!enRetard.length) {
    logger.info('[manquant-alert] Aucun manquant persistant');
    return;
  }

  // Tri par manquant décroissant, top 10 dans le corps.
  const top = [...enRetard].sort((a, b) => b.manquant - a.manquant).slice(0, 10);
  const totalLitres = Math.round(enRetard.reduce((s, l) => s + l.manquant, 0));
  const body = top
    .map((l) => `${l.siteCode} — ${l.manquant} L (BL ${l.numeroBL}, ${l.jours} j)`)
    .join('\n')
    .slice(0, 1000);

  await notificationService.sendToRole('MANAGER', {
    type: 'MANQUANT_LIVRAISON',
    title: `🚚 ${enRetard.length} manquant(s) de livraison — ${totalLitres} L`,
    body,
    data: { kind: 'manquant_livraison', count: enRetard.length, totalLitres },
  });

  logger.info(`[manquant-alert] ${enRetard.length} manquants signalés aux managers (${totalLitres} L)`);
}
