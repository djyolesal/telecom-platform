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
  SMTP_FROM: z.string().default('E&M OpS <noreply@emops.uk>'),
  SMTP_REPLY_TO: z.string().optional(),
  // Passerelle SMS (contrat SMS Pro Moov Africa) — sans SMS_API_URL, les envois
  // sont journalisés en mode SIMULE (aucun SMS réel, aucune erreur).
  SMS_API_URL: z.string().optional(),
  SMS_API_TOKEN: z.string().optional(),
  SMS_SENDER: z.string().default('EMOPS'),

  // Firebase Cloud Messaging
  FCM_SERVER_KEY: z.string().optional(),

  // Divers
  APP_URL: z.string().default('http://localhost:3000'),
  // Origines autorisées (CORS + Socket.IO). Défaut = origine locale du portail
  // (JAMAIS '*' avec credentials). En prod, fixer l'URL publique via l'env.
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  // Jeton facultatif protégeant /metrics (défense en profondeur).
  METRICS_TOKEN: z.string().optional(),

  // Règles terrain (configurables)
  MIN_DUREE_CLOTURE_MIN: z.coerce.number().default(60), // durée min (min) avant clôture
  GEOFENCE_RADIUS_M: z.coerce.number().default(20),     // rayon (m) « sur site »
  SEUIL_ECART_GASOIL_PCT: z.coerce.number().default(25), // tolérance (%) écart conso gasoil réelle vs attendue
  DELAI_MANQUANT_JOURS: z.coerce.number().default(7),    // délai (j) après chargement avant qu'un reste soit « en retard »
  MANQUANT_MIN_LITRES: z.coerce.number().default(50),    // plancher anti-bruit : en-deçà, on n'alerte pas
  MANQUANT_CRITIQUE_LITRES: z.coerce.number().default(800),       // manquant site critique → alerte immédiate + escalade
  MANQUANT_CAMION_CRITIQUE_LITRES: z.coerce.number().default(500), // écart chargé−distribué d'un camion → alerte immédiate
  // Réapprovisionnement prédictif
  APPRO_LEAD_TIME_JOURS: z.coerce.number().default(3),       // délai entre décision d'appro et livraison effective
  APPRO_STOCK_SECURITE_JOURS: z.coerce.number().default(3),  // marge de sécurité (jours de conso) avant rupture
  APPRO_HORIZON_JOURS: z.coerce.number().default(14),        // fenêtre de planification
  CAMION_CAPACITE_LITRES: z.coerce.number().default(10000),  // capacité d'un camion pour le découpage en tournées
  // Synthèse en langage naturel (optionnelle) — activée si une clé API Claude est fournie
  ANTHROPIC_API_KEY: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Variables d\'environnement invalides :', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
