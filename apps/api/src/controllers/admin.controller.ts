import { Request, Response, NextFunction } from 'express';
import os from 'os';
import { parseISO } from 'date-fns';
import { prisma } from '../config/database';
import { redisClient } from '../config/redis';
import { minioClient, MINIO_BUCKET } from '../config/minio';
import { paginate } from '../utils/paginator';
import { auditLog } from '../services/audit.service';
import { logger } from '../utils/logger';

// ── Paramètres système (clé/valeur JSON) ─────────────────────
export async function getSettings(_req: Request, res: Response, next: NextFunction) {
  try {
    const settings = await prisma.systemSettings.findMany({ orderBy: { key: 'asc' } });
    res.json({ success: true, data: settings });
  } catch (err) { next(err); }
}

export async function updateSettings(req: Request, res: Response, next: NextFunction) {
  try {
    const entries: Array<{ key: string; value: unknown; description?: string }> =
      Array.isArray(req.body) ? req.body : [req.body];

    const updated = await Promise.all(
      entries.map((e) =>
        prisma.systemSettings.upsert({
          where: { key: e.key },
          create: { key: e.key, value: e.value as object, description: e.description, updatedBy: req.user!.id },
          update: { value: e.value as object, description: e.description, updatedBy: req.user!.id },
        })
      )
    );

    await auditLog(req.user!.id, 'UPDATE', 'system_settings', undefined, { keys: entries.map((e) => e.key) }, req);
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

// ── Journal d'audit ──────────────────────────────────────────
export async function getAuditLogs(req: Request, res: Response, next: NextFunction) {
  try {
    const { user_id, action, resource, date_debut, date_fin, page = '1', limit = '30' } =
      req.query as Record<string, string>;

    const where: Record<string, unknown> = {};
    if (user_id) where.userId = user_id;
    if (action) where.action = action;
    if (resource) where.resource = resource;
    if (date_debut || date_fin) {
      where.createdAt = {
        ...(date_debut ? { gte: parseISO(date_debut) } : {}),
        ...(date_fin ? { lte: parseISO(date_fin) } : {}),
      };
    }

    const { data, meta } = await paginate(
      prisma.auditLog,
      {
        where,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { nom: true, prenom: true, email: true, role: true } } },
      },
      { page: parseInt(page), limit: parseInt(limit) }
    );

    res.json({ success: true, data, meta });
  } catch (err) { next(err); }
}

// ── Santé des services Docker ────────────────────────────────
async function checkHttp(name: string, url: string): Promise<ServiceHealth> {
  const start = Date.now();
  try {
    const ctrl = AbortSignal.timeout(3000);
    const r = await fetch(url, { signal: ctrl });
    return { service: name, status: r.ok ? 'up' : 'degraded', latencyMs: Date.now() - start };
  } catch {
    return { service: name, status: 'down', latencyMs: Date.now() - start };
  }
}

interface ServiceHealth {
  service: string;
  status: 'up' | 'down' | 'degraded';
  latencyMs: number;
}

export async function getSystemHealth(_req: Request, res: Response, next: NextFunction) {
  try {
    const checks = await Promise.all([
      (async (): Promise<ServiceHealth> => {
        const start = Date.now();
        try { await prisma.$queryRaw`SELECT 1`; return { service: 'postgres', status: 'up', latencyMs: Date.now() - start }; }
        catch { return { service: 'postgres', status: 'down', latencyMs: Date.now() - start }; }
      })(),
      (async (): Promise<ServiceHealth> => {
        const start = Date.now();
        try { await redisClient.ping(); return { service: 'redis', status: 'up', latencyMs: Date.now() - start }; }
        catch { return { service: 'redis', status: 'down', latencyMs: Date.now() - start }; }
      })(),
      (async (): Promise<ServiceHealth> => {
        const start = Date.now();
        try { await minioClient.bucketExists(MINIO_BUCKET); return { service: 'minio', status: 'up', latencyMs: Date.now() - start }; }
        catch { return { service: 'minio', status: 'down', latencyMs: Date.now() - start }; }
      })(),
      checkHttp('web', 'http://web:3000/api/health'),
      checkHttp('prometheus', 'http://prometheus:9090/-/healthy'),
      checkHttp('grafana', 'http://grafana:3000/api/health'),
    ]);

    const api: ServiceHealth = { service: 'api', status: 'up', latencyMs: 0 };
    const services = [api, ...checks];
    const globalStatus = services.every((s) => s.status === 'up') ? 'healthy'
      : services.some((s) => s.status === 'down') ? 'unhealthy' : 'degraded';

    res.json({ success: true, data: { status: globalStatus, services, timestamp: new Date().toISOString() } });
  } catch (err) { next(err); }
}

// ── Métriques serveur (CPU / RAM / charge) ───────────────────
export async function getMetrics(_req: Request, res: Response, next: NextFunction) {
  try {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const cpus = os.cpus();
    const load = os.loadavg();

    res.json({
      success: true,
      data: {
        hostname: os.hostname(),
        uptimeSeconds: Math.round(os.uptime()),
        cpu: {
          cores: cpus.length,
          model: cpus[0]?.model ?? 'inconnu',
          load1: Number(load[0].toFixed(2)),
          load5: Number(load[1].toFixed(2)),
          load15: Number(load[2].toFixed(2)),
        },
        memory: {
          totalMB: Math.round(totalMem / 1024 / 1024),
          usedMB: Math.round((totalMem - freeMem) / 1024 / 1024),
          freeMB: Math.round(freeMem / 1024 / 1024),
          usedPercent: Math.round(((totalMem - freeMem) / totalMem) * 100),
        },
        process: {
          rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
          nodeVersion: process.version,
          uptimeSeconds: Math.round(process.uptime()),
        },
      },
    });
  } catch (err) {
    logger.error('Erreur metrics:', err);
    next(err);
  }
}
