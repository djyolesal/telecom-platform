import multer from 'multer';
import { AppError } from '../utils/AppError';

/**
 * Middleware Multer — stockage en mémoire, le buffer est ensuite poussé
 * vers MinIO par le storage.service. Limite à 20 Mo (cf. nginx client_max_body_size).
 */
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
]);

export const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    cb(new AppError(`Type de fichier non autorisé : ${file.mimetype}`, 415));
  },
});
