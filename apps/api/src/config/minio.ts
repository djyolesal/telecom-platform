import { Client as MinioClient } from 'minio';
import { env } from './env';
import { logger } from '../utils/logger';

/**
 * Client MinIO (S3-compatible) pour le stockage des photos,
 * signatures, bons de livraison et rapports PDF.
 */
export const minioClient = new MinioClient({
  endPoint: env.MINIO_ENDPOINT,
  port: env.MINIO_PORT,
  useSSL: env.MINIO_USE_SSL,
  accessKey: env.MINIO_ACCESS_KEY,
  secretKey: env.MINIO_SECRET_KEY,
});

export const MINIO_BUCKET = env.MINIO_BUCKET;

/** Crée le bucket s'il n'existe pas et s'assure qu'il reste PRIVÉ. */
export async function ensureBucket(): Promise<void> {
  const exists = await minioClient.bucketExists(MINIO_BUCKET).catch(() => false);
  if (!exists) {
    await minioClient.makeBucket(MINIO_BUCKET, 'us-east-1');
    logger.info(`✅ Bucket MinIO créé : ${MINIO_BUCKET}`);
  }

  // Bucket PRIVÉ : plus aucune policy anonyme. Les objets sont servis
  // exclusivement par la passerelle signée /api/v1/files (storage.service).
  // Une lecture publique rendait toute photo d'intervention accessible à qui
  // connaissait sa clé — y compris après le départ d'un prestataire.
  await minioClient.setBucketPolicy(MINIO_BUCKET, '').catch(() => {
    /* Aucune policy à retirer : c'est déjà l'état voulu. */
  });
}
