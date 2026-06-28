import { z } from 'zod';
import 'dotenv/config';

/**
 * Schéma de validation des variables d'environnement.
 * L'application refuse de démarrer si une variable obligatoire est absente ou invalide.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),

  // Base de données
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // MinIO
  MINIO_ENDPOINT: z.string().default('minio'),
  MINIO_PORT: z.coerce.number().default(9000),
  MINIO_ACCESS_KEY: z.string(),
  MINIO_SECRET_KEY: z.string(),
  MINIO_BUCKET: z.string().default('telecom-files'),
  MINIO_USE_SSL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // JWT
  JWT_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default('12h'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

  // SMTP
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('noreply@telecom.local'),

  // Firebase Cloud Messaging
  FCM_SERVER_KEY: z.string().optional(),

  // Divers
  APP_URL: z.string().default('http://localhost:3000'),
  CORS_ORIGIN: z.string().default('*'),

  // Règles terrain (configurables)
  MIN_DUREE_CLOTURE_MIN: z.coerce.number().default(60), // durée min (min) avant clôture
  GEOFENCE_RADIUS_M: z.coerce.number().default(20),     // rayon (m) « sur site »
  SEUIL_ECART_GASOIL_PCT: z.coerce.number().default(25), // tolérance (%) écart conso gasoil réelle vs attendue
  DELAI_MANQUANT_JOURS: z.coerce.number().default(7),    // délai (j) après chargement avant qu'un reste soit « en retard »
  MANQUANT_MIN_LITRES: z.coerce.number().default(50),    // plancher anti-bruit : en-deçà, on n'alerte pas
  MANQUANT_CRITIQUE_LITRES: z.coerce.number().default(800),       // manquant site critique → alerte immédiate + escalade
  MANQUANT_CAMION_CRITIQUE_LITRES: z.coerce.number().default(500), // écart chargé−distribué d'un camion → alerte immédiate
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Variables d\'environnement invalides :', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
