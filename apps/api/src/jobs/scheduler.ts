import cron from 'node-cron';
import { logger } from '../utils/logger';
import { stockAlertJob } from './stock-alert';
import { maintenanceReminderJob } from './maintenance-reminder';
import { monthlyReportJob } from './monthly-report';
import { dbBackupJob } from './db-backup';
import { incidentEscalationJob } from './incident-escalation';
import { preventivePlanJob } from './preventive-plan';
import { manquantAlertJob } from './manquant-alert';

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

  // ── Backup BDD — tous les jours à 2h ───────────────────────
  cron.schedule('0 2 * * *', async () => {
    logger.info('[CRON] Démarrage backup base de données');
    try { await dbBackupJob(); } catch (e) { logger.error('[CRON] dbBackup error:', e); }
  }, { timezone: 'Africa/Lome' });

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

  logger.info('✅ 7 cron jobs planifiés (TZ: Africa/Lome)');
}
