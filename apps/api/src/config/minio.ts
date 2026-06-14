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

/** Crée le bucket s'il n'existe pas et applique une policy de lecture publique. */
export async function ensureBucket(): Promise<void> {
  const exists = await minioClient.bucketExists(MINIO_BUCKET).catch(() => false);
  if (!exists) {
    await minioClient.makeBucket(MINIO_BUCKET, 'us-east-1');
    logger.info(`✅ Bucket MinIO créé : ${MINIO_BUCKET}`);
  }

  // Lecture publique des objets (les URLs sont servies derrière Nginx)
  const policy = {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { AWS: ['*'] },
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${MINIO_BUCKET}/*`],
      },
    ],
  };
  await minioClient.setBucketPolicy(MINIO_BUCKET, JSON.stringify(policy)).catch((e) => {
    logger.warn('Impossible d\'appliquer la policy MinIO:', e.message);
  });
}
