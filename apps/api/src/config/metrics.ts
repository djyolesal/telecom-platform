import { Request, Response, NextFunction } from 'express';
import client from 'prom-client';

/**
 * Registre Prometheus exposé sur /metrics (scrappé par le conteneur prometheus).
 * Collecte les métriques système par défaut + un histogramme de latence HTTP.
 */
export const registry = new client.Registry();
registry.setDefaultLabels({ app: 'telecom-api' });
client.collectDefaultMetrics({ register: registry });

const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Durée des requêtes HTTP en secondes',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [registry],
});

const httpTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Nombre total de requêtes HTTP',
  labelNames: ['method', 'route', 'status'],
  registers: [registry],
});

/** Middleware Express : mesure la latence et compte les requêtes. */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const end = httpDuration.startTimer();
  res.on('finish', () => {
    const route = (req.route?.path as string) || req.path || 'unknown';
    const labels = { method: req.method, route, status: String(res.statusCode) };
    end(labels);
    httpTotal.inc(labels);
  });
  next();
}

/** Handler de l'endpoint /metrics. */
export async function metricsHandler(_req: Request, res: Response) {
  res.set('Content-Type', registry.contentType);
  res.end(await registry.metrics());
}
