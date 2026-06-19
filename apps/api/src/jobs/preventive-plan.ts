import { genererPlanningPreventif } from '../services/planning.service';
import { logger } from '../utils/logger';

/**
 * Génération automatique du planning préventif contractuel.
 * Crée les maintenances préventives dues pour le mois (par site × tâche éligible).
 */
export async function preventivePlanJob(): Promise<void> {
  const result = await genererPlanningPreventif(0);
  logger.info(`[CRON] Planning préventif : ${result.crees} maintenance(s) créée(s), ${result.ignoresSansPrestataire} ignorée(s) (sans prestataire passif)`);
}
