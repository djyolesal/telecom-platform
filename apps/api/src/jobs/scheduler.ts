import cron from 'node-cron';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';
import { stockAlertJob } from './stock-alert';
import { maintenanceReminderJob } from './maintenance-reminder';
import { monthlyReportJob } from './monthly-report';
import { incidentEscalationJob } from './incident-escalation';
import { preventivePlanJob } from './preventive-plan';
import { manquantAlertJob } from './manquant-alert';
import { vidangeAlertJob } from './vidange-alert';
import { situationPeriodiqueJob } from './situation-periodique';
import { purgeOrphelinsJob } from './purge-orphelins';

/**
 * Verrou Postgres par job : `node-cron` n'attend pas la fin d'un callback async
 * (une exécution longue chevauchait la suivante) et plusieurs réplicas
 * exécuteraient le même job. `pg_try_advisory_lock` échoue immédiatement si le
 * job tourne déjà — la durée est journalisée pour repérer les dérives.
 */
async function avecVerrou(nom: string, fn: () => Promise<void>): Promise<void> {
  const cle = `job:${nom}`;
  // Verrou consultatif de TRANSACTION (pg_advisory_xact_lock) tenu par la
  // connexion épinglée de la transaction interactive, et libéré AUTOMATIQUEMENT
  // à sa fin. Auparavant le lock (pg_try_advisory_lock, portée session) et son
  // unlock partaient sur deux connexions différentes du pool Prisma : l'unlock
  // était un no-op, le verrou fuyait, et les nuits suivantes le job était sauté
  // « déjà en cours » alors que rien ne tournait. Le corps du job (`fn`, sur le
  // client global) s'exécute PENDANT que la transaction garde le verrou.
  const t0 = Date.now();
  try {
    await prisma.$transaction(async (tx) => {
      const [{ pris }] = await tx.$queryRaw<{ pris: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtext(${cle})::bigint) AS pris`;
      if (!pris) { logger.warn(`[CRON] ${nom} déjà en cours (verrou) — exécution ignorée`); return; }
      await fn();
      logger.info(`[CRON] ${nom} terminé en ${Math.round((Date.now() - t0) / 1000)}s`);
    }, {
      // La transaction reste ouverte le temps du job (verrou tenu) : plafond
      // large pour ne pas avorter un job long (rapport mensuel).
      timeout: 30 * 60_000,
      maxWait: 5_000,
    });
  } catch (e) {
    logger.error(`[CRON] ${nom} : échec (verrou/transaction)`, e);
  }
}

export function setupCronJobs() {
  // ── Ménage du stockage — tous les jours à 4h30 (après le backup de 3h,
  // qui garde ainsi une dernière copie des objets sur le point d'être purgés) ──
  cron.schedule('30 4 * * *', async () => {
    logger.info('[CRON] Démarrage job purge des fichiers orphelins');
    try { await avecVerrou('purgeOrphelins', purgeOrphelinsJob); } catch (e) { logger.error('[CRON] purgeOrphelins error:', e); }
  }, { timezone: 'Africa/Lome' });

  // ── Vérif stock carburant — tous les jours à 8h ─────────────
  cron.schedule('0 8 * * *', async () => {
    logger.info('[CRON] Démarrage job vérification stock carburant');
    try { await avecVerrou('stockAlert', stockAlertJob); } catch (e) { logger.error('[CRON] stockAlert error:', e); }
  }, { timezone: 'Africa/Lome' });

  // ── Rappels maintenances — tous les jours à 7h ──────────────
  cron.schedule('0 7 * * *', async () => {
    logger.info('[CRON] Démarrage job rappels maintenances');
    try { await avecVerrou('maintenanceReminder', maintenanceReminderJob); } catch (e) { logger.error('[CRON] maintenanceReminder error:', e); }
  }, { timezone: 'Africa/Lome' });

  // ── Rapport mensuel — 1er du mois à 6h ─────────────────────
  cron.schedule('0 6 1 * *', async () => {
    logger.info('[CRON] Démarrage rapport mensuel automatique');
    try { await avecVerrou('monthlyReport', monthlyReportJob); } catch (e) { logger.error('[CRON] monthlyReport error:', e); }
  }, { timezone: 'Africa/Lome' });

  // ── Sauvegarde : PAS ici. La sauvegarde complète (base + fichiers MinIO +
  // copie hors-site) est faite par le cron SYSTÈME de l'hôte qui appelle
  // infra/scripts/backup.sh (le conteneur API n'a ni pg_dump ni accès au volume
  // MinIO). Voir infra/scripts/setup-server.sh. Ne pas réintroduire de job de
  // backup applicatif : il tournerait à vide et donnerait une fausse assurance.

  // ── Escalade incidents — toutes les heures ──────────────────
  cron.schedule('0 * * * *', async () => {
    logger.info('[CRON] Vérification escalade incidents');
    try { await avecVerrou('escalation', incidentEscalationJob); } catch (e) { logger.error('[CRON] escalation error:', e); }
  }, { timezone: 'Africa/Lome' });

  // ── Planning préventif contractuel — 1er du mois à 5h ──────
  cron.schedule('0 5 1 * *', async () => {
    logger.info('[CRON] Génération du planning préventif mensuel');
    try { await avecVerrou('preventivePlan', preventivePlanJob); } catch (e) { logger.error('[CRON] preventivePlan error:', e); }
  }, { timezone: 'Africa/Lome' });

  // ── Manquants de livraison — tous les jours à 9h ────────────
  cron.schedule('0 9 * * *', async () => {
    logger.info('[CRON] Vérification des manquants de livraison');
    try { await avecVerrou('manquantAlert', manquantAlertJob); } catch (e) { logger.error('[CRON] manquantAlert error:', e); }
  }, { timezone: 'Africa/Lome' });

  // ── Vidanges GE dues (≥ seuil d'heures) — tous les jours à 7h30 ──
  cron.schedule('30 7 * * *', async () => {
    logger.info('[CRON] Vérification des vidanges GE dues');
    try { await avecVerrou('vidangeAlert', vidangeAlertJob); } catch (e) { logger.error('[CRON] vidangeAlert error:', e); }
  }, { timezone: 'Africa/Lome' });

  // ── Situation périodique incidents/coupures — vérifiée tous les quarts d'heure,
  //    émise seulement quand l'intervalle paramétré (défaut 3 h) est écoulé.
  cron.schedule('*/15 * * * *', async () => {
    try { await avecVerrou('situationPeriodique', situationPeriodiqueJob); } catch (e) { logger.error('[CRON] situationPeriodique error:', e); }
  }, { timezone: 'Africa/Lome' });

  logger.info('✅ 9 cron jobs planifiés (TZ: Africa/Lome ; sauvegarde = cron système hôte)');
}
