import cron from 'node-cron';
import { logger } from '../utils/logger';
import { stockAlertJob } from './stock-alert';
import { maintenanceReminderJob } from './maintenance-reminder';
import { monthlyReportJob } from './monthly-report';
import { incidentEscalationJob } from './incident-escalation';
import { preventivePlanJob } from './preventive-plan';
import { manquantAlertJob } from './manquant-alert';
import { vidangeAlertJob } from './vidange-alert';

export function setupCronJobs() {
  // ── Vérif stock carburant — tous les jours à 8h ─────────────
  cron.schedule('0 8 * * *', async () => {
    logger.info('[CRON] Démarrage job vérification stock carburant');
    try { await stockAlertJob(); } catch (e) { logger.error('[CRON] stockAlert error:', e); }
  }, { timezone: 'Africa/Lome' });

  // ── Rappels maintenances — tous les jours à 7h ──────────────
  cron.schedule('0 7 * * *', async () => {
    logger.info('[CRON] Démarrage job rappels maintenances');
    try { await maintenanceReminderJob(); } catch (e) { logger.error('[CRON] maintenanceReminder error:', e); }
  }, { timezone: 'Africa/Lome' });

  // ── Rapport mensuel — 1er du mois à 6h ─────────────────────
  cron.schedule('0 6 1 * *', async () => {
    logger.info('[CRON] Démarrage rapport mensuel automatique');
    try { await monthlyReportJob(); } catch (e) { logger.error('[CRON] monthlyReport error:', e); }
  }, { timezone: 'Africa/Lome' });

  // ── Sauvegarde : PAS ici. La sauvegarde complète (base + fichiers MinIO +
  // copie hors-site) est faite par le cron SYSTÈME de l'hôte qui appelle
  // infra/scripts/backup.sh (le conteneur API n'a ni pg_dump ni accès au volume
  // MinIO). Voir infra/scripts/setup-server.sh. Ne pas réintroduire de job de
  // backup applicatif : il tournerait à vide et donnerait une fausse assurance.

  // ── Escalade incidents — toutes les heures ──────────────────
  cron.schedule('0 * * * *', async () => {
    logger.info('[CRON] Vérification escalade incidents');
    try { await incidentEscalationJob(); } catch (e) { logger.error('[CRON] escalation error:', e); }
  }, { timezone: 'Africa/Lome' });

  // ── Planning préventif contractuel — 1er du mois à 5h ──────
  cron.schedule('0 5 1 * *', async () => {
    logger.info('[CRON] Génération du planning préventif mensuel');
    try { await preventivePlanJob(); } catch (e) { logger.error('[CRON] preventivePlan error:', e); }
  }, { timezone: 'Africa/Lome' });

  // ── Manquants de livraison — tous les jours à 9h ────────────
  cron.schedule('0 9 * * *', async () => {
    logger.info('[CRON] Vérification des manquants de livraison');
    try { await manquantAlertJob(); } catch (e) { logger.error('[CRON] manquantAlert error:', e); }
  }, { timezone: 'Africa/Lome' });

  // ── Vidanges GE dues (≥ seuil d'heures) — tous les jours à 7h30 ──
  cron.schedule('30 7 * * *', async () => {
    logger.info('[CRON] Vérification des vidanges GE dues');
    try { await vidangeAlertJob(); } catch (e) { logger.error('[CRON] vidangeAlert error:', e); }
  }, { timezone: 'Africa/Lome' });

  logger.info('✅ 7 cron jobs planifiés (TZ: Africa/Lome ; sauvegarde = cron système hôte)');
}
