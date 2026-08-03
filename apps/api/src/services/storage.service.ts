import { randomUUID, createHmac, timingSafeEqual } from 'crypto';
import path from 'path';
import { minioClient, MINIO_BUCKET } from '../config/minio';
import { env } from '../config/env';

export interface StoredFile {
  url: string;
  key: string;
}

/**
 * URL d'accès à un objet, SIGNÉE et à durée de vie limitée.
 *
 * Le bucket était en lecture publique derrière Nginx : toute personne
 * connaissant (ou devinant, via un lien partagé, un référent HTTP ou un journal
 * de proxy) la clé d'un objet lisait photos d'intervention, signatures et
 * bordereaux sans authentification. Les URLs passent désormais par la
 * passerelle `/api/v1/files/<clé>?t=<exp>.<hmac>` : elles restent utilisables
 * dans une balise <img> (pas d'en-tête Authorization à poser) mais expirent.
 *
 * Calculée à la volée (jamais figée en base) → robuste si le domaine change.
 */
const FICHIER_TTL_S = 24 * 3600;

function hmac(cle: string, exp: number): string {
  return createHmac('sha256', env.JWT_SECRET).update(`${cle}|${exp}`).digest('base64url');
}

/** Jeton `exp.signature` pour une clé d'objet. */
export function signerCle(key: string, ttlSecondes = FICHIER_TTL_S): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSecondes;
  return `${exp}.${hmac(key, exp)}`;
}

/** Vérifie un jeton (comparaison à temps constant + expiration). */
export function verifierJeton(key: string, jeton: string): boolean {
  const [expBrut, sig] = String(jeton).split('.');
  const exp = Number(expBrut);
  if (!Number.isFinite(exp) || !sig) return false;
  if (exp < Math.floor(Date.now() / 1000)) return false;
  const attendu = Buffer.from(hmac(key, exp));
  const fourni = Buffer.from(sig);
  return attendu.length === fourni.length && timingSafeEqual(attendu, fourni);
}

export function publicFileUrl(key: string): string {
  const chemin = key.split('/').map(encodeURIComponent).join('/');
  return `${env.APP_URL}/api/v1/files/${chemin}?t=${signerCle(key)}`;
}

/**
 * Pousse un buffer vers MinIO et renvoie la clé + une URL signée.
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

  return { key, url: publicFileUrl(key) };
}

/** Supprime un objet du bucket. */
export async function deleteObject(key: string): Promise<void> {
  await minioClient.removeObject(MINIO_BUCKET, key);
}

/** Récupère le contenu d'un objet MinIO sous forme de Buffer (ex: logo à embarquer dans un xlsx). */
export async function getObjectBuffer(key: string): Promise<Buffer> {
  const stream = await minioClient.getObject(MINIO_BUCKET, key);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
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

/** Métadonnées + flux d'un objet, pour la passerelle de téléchargement. */
export async function statObject(key: string) {
  return minioClient.statObject(MINIO_BUCKET, key);
}

export async function getObjectStream(key: string) {
  return minioClient.getObject(MINIO_BUCKET, key);
}
