import { genererPlanningPreventif } from '../services/planning.service';
import { getNum } from '../services/settings.service';
import { logger } from '../utils/logger';

/**
 * Génération automatique du planning préventif contractuel.
 * Crée les maintenances préventives dues pour le mois (par site × tâche éligible).
 */
export async function preventivePlanJob(): Promise<void> {
  // Interrupteur (Administration → Paramètres) : coupé = aucune génération,
  // la planification redevient entièrement manuelle jusqu'à réactivation.
  if (getNum('planning.autoActif', 1) !== 1) {
    logger.info('[CRON] Planning préventif automatique DÉSACTIVÉ (planning.autoActif=0) - aucune génération');
    return;
  }
  const result = await genererPlanningPreventif(0);
  logger.info(`[CRON] Planning préventif : ${result.crees} maintenance(s) créée(s), ${result.ignoresSansPrestataire} ignorée(s) (sans prestataire passif)`);
}
