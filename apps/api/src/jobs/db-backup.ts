import { spawn } from 'child_process';
import { createGzip } from 'zlib';
import { createWriteStream, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import path from 'path';
import { env } from '../config/env';
import { logger } from '../utils/logger';

const BACKUP_DIR = process.env.BACKUP_DIR || '/app/backups';
const RETENTION_DAYS = 30;

/**
 * Sauvegarde la base via pg_dump → fichier .sql.gz horodaté.
 * Best-effort : si pg_dump est absent du conteneur, on log un avertissement
 * (les backups sont aussi gérés au niveau OS via `make backup` + cron).
 */
export async function dbBackupJob(): Promise<void> {
  try {
    mkdirSync(BACKUP_DIR, { recursive: true });
  } catch {
    /* ignore */
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outFile = path.join(BACKUP_DIR, `backup_${stamp}.sql.gz`);

  await new Promise<void>((resolve) => {
    const dump = spawn('pg_dump', [env.DATABASE_URL, '--no-owner', '--no-privileges'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    dump.stderr.on('data', (d) => (stderr += d.toString()));

    dump.on('error', (err) => {
      logger.warn(`[db-backup] pg_dump indisponible dans le conteneur (${err.message}). Backups gérés au niveau OS.`);
      resolve();
    });

    const gzip = createGzip();
    const out = createWriteStream(outFile);
    dump.stdout.pipe(gzip).pipe(out);

    out.on('finish', () => {
      logger.info(`[db-backup] Backup créé : ${outFile}`);
      cleanupOldBackups();
      resolve();
    });
    out.on('error', (err) => {
      logger.error('[db-backup] Écriture échouée:', err);
      resolve();
    });
    dump.on('close', (code) => {
      if (code !== 0 && stderr) logger.warn(`[db-backup] pg_dump code ${code}: ${stderr.slice(0, 200)}`);
    });
  });
}

function cleanupOldBackups(): void {
  try {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const f of readdirSync(BACKUP_DIR)) {
      if (!f.endsWith('.sql.gz')) continue;
      const full = path.join(BACKUP_DIR, f);
      if (statSync(full).mtimeMs < cutoff) {
        unlinkSync(full);
        logger.info(`[db-backup] Ancien backup supprimé : ${f}`);
      }
    }
  } catch (err) {
    logger.warn('[db-backup] Nettoyage échoué:', err);
  }
}
