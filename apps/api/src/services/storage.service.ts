import { randomUUID } from 'crypto';
import path from 'path';
import { minioClient, MINIO_BUCKET } from '../config/minio';
import { env } from '../config/env';

export interface StoredFile {
  url: string;
  key: string;
}

/**
 * Pousse un buffer vers MinIO et renvoie la clé + l'URL publique (servie via Nginx /minio).
 * @param folder sous-dossier logique (photos, signatures, documents, rapports...)
 */
export async function uploadBuffer(
  buffer: Buffer,
  originalName: string,
  mimeType: string,
  folder = 'documents'
): Promise<StoredFile> {
  const ext = path.extname(originalName) || mimeExt(mimeType);
  const key = `${folder}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${ext}`;

  await minioClient.putObject(MINIO_BUCKET, key, buffer, buffer.length, {
    'Content-Type': mimeType,
  });

  // URL publique servie par Nginx (/storage/ → API objets MinIO :9000, bucket en lecture publique)
  return { key, url: `${env.APP_URL}/storage/${MINIO_BUCKET}/${key}` };
}

/** Supprime un objet du bucket. */
export async function deleteObject(key: string): Promise<void> {
  await minioClient.removeObject(MINIO_BUCKET, key);
}

function mimeExt(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/heic': '.heic',
    'application/pdf': '.pdf',
  };
  return map[mime] ?? '';
}
