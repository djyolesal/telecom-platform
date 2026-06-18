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

// Import de tableurs (.xlsx). Le mimetype varie selon le navigateur/OS,
// on accepte donc aussi sur l'extension du nom de fichier.
const SPREADSHEET_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream',
  'text/csv',
  'application/csv',
]);

export const uploadSpreadsheet = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = SPREADSHEET_MIME.has(file.mimetype) || /\.(xlsx|xls|csv)$/i.test(file.originalname);
    if (ok) return cb(null, true);
    cb(new AppError(`Format non autorisé : importez un fichier .xlsx (${file.mimetype})`, 415));
  },
});
