import 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { Server as SocketIOServer } from 'socket.io';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';

import { env } from './config/env';
import { prisma } from './config/database';
import { redisClient } from './config/redis';
import { ensureBucket } from './config/minio';
import { metricsMiddleware, metricsHandler } from './config/metrics';
import { setupSocketIO } from './sockets';
import { setupCronJobs } from './jobs/scheduler';
import { loadSettings } from './services/settings.service';
import { loadTacheOverrides } from './services/tachesPreventives.service';
import { router } from './routes';
import { errorHandler } from './middlewares/errorHandler';
import { logger } from './utils/logger';

const app = express();
const httpServer = http.createServer(app);

// ── Socket.IO ────────────────────────────────────────────────
export const io = new SocketIOServer(httpServer, {
  cors: { origin: env.CORS_ORIGIN, credentials: true },
  transports: ['websocket', 'polling'],
});
setupSocketIO(io);

// ── Middlewares ───────────────────────────────────────────────
// Derrière nginx : sans cela `req.ip` vaut l'IP du conteneur proxy pour TOUTES
// les requêtes → le plafond anti-bruteforce devient global (61 tentatives
// bloquent la plateforme entière) et le journal d'audit perd l'IP réelle.
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
// `combined` journalise l'URL complète : on masque le jeton de fichier signé
// (?t=<exp>.<hmac>) — une capacité de lecture valable 24 h ne doit pas traîner
// en clair dans les logs applicatifs (ni l'access_log nginx, à masquer côté infra).
morgan.token('url', (req) => (req as { originalUrl?: string; url?: string }).originalUrl?.replace(/([?&]t=)[^&\s"]+/g, '$1***') ?? '');
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));
app.use(metricsMiddleware);

// ── Métriques Prometheus ──────────────────────────────────────
// Scrapées par Prometheus DANS le réseau Docker interne. Si METRICS_TOKEN est
// défini, l'exiger (défense en profondeur au cas où /metrics serait exposé).
app.get('/metrics', (req, res) => {
  const token = env.METRICS_TOKEN;
  if (token && req.header('Authorization') !== `Bearer ${token}`) {
    return res.status(401).end();
  }
  return metricsHandler(req, res);
});

// ── Swagger ───────────────────────────────────────────────────
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: { title: 'Telecom API', version: '1.0.0', description: 'API Plateforme Gestion Télécom & Énergie' },
    servers: [{ url: '/api/v1' }],
    components: {
      securitySchemes: {
        BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
    security: [{ BearerAuth: [] }],
  },
  apis: ['./src/routes/*.ts'],
};
// Documentation d'API : exposée hors production uniquement (ne pas divulguer la
// surface d'API en prod).
if (env.NODE_ENV !== 'production') {
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerJsdoc(swaggerOptions)));
}

// ── Health check ──────────────────────────────────────────────
// La version vient de package.json (figée à l'image Docker) : un simple
// `curl /api/v1/health` dit ce qui tourne réellement en production.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version: versionApi } = require('../package.json') as { version: string };
app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    await redisClient.ping();
    res.json({ status: 'ok', timestamp: new Date().toISOString(), version: versionApi });
  } catch (err) {
    res.status(503).json({ status: 'error', message: String(err) });
  }
});

// ── Routes API ────────────────────────────────────────────────
app.use('/v1', router);

// ── Error handler ─────────────────────────────────────────────
app.use(errorHandler);

// ── Démarrage ─────────────────────────────────────────────────
async function bootstrap() {
  try {
    await prisma.$connect();
    logger.info('✅ PostgreSQL connecté');

    await loadSettings();
    logger.info('✅ Paramètres système chargés');

    await loadTacheOverrides();
    logger.info('✅ Surcharges tâches préventives chargées');

    await redisClient.connect();
    logger.info('✅ Redis connecté');

    await ensureBucket();
    logger.info('✅ Bucket MinIO prêt');

    setupCronJobs();
    logger.info('✅ Cron jobs démarrés');

    httpServer.listen(env.PORT, () => {
      logger.info(`✅ API démarrée sur le port ${env.PORT}`);
      logger.info(`📚 Swagger : http://localhost:${env.PORT}/docs`);
    });
  } catch (err) {
    logger.error('❌ Erreur démarrage:', err);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM reçu — arrêt gracieux...');
  await prisma.$disconnect();
  await redisClient.quit();
  httpServer.close(() => process.exit(0));
});

bootstrap();
