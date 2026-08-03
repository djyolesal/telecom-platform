import multer from 'multer';
import { Request, Response, NextFunction } from 'express';
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

/**
 * Vérification du contenu réel des fichiers (nombres magiques).
 *
 * `fileFilter` de Multer ne voit que l'en-tête `Content-Type` du client, qui est
 * déclaratif : un .html ou un .svg piégé annoncé `image/png` passait le filtre,
 * atterrissait dans MinIO et était ensuite servi tel quel — XSS stockée sur le
 * domaine. On relit ici les premiers octets du buffer, seuls faisant foi.
 */
const SIGNATURES: Array<{ mime: string; test: (b: Buffer) => boolean }> = [
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  // HEIC/HEIF : boîte ISO-BMFF `ftyp` avec une marque de la famille HEIF.
  { mime: 'image/heic', test: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' && /^(heic|heix|hevc|heim|heis|mif1|msf1)/.test(b.subarray(8, 12).toString('latin1')) },
  { mime: 'application/pdf', test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
];

/** Type réel déduit des octets, ou null si aucune signature connue. */
export function typeReel(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  return SIGNATURES.find((s) => s.test(buffer))?.mime ?? null;
}

/** À placer APRÈS `uploadMiddleware.single(...)` sur les routes d'upload. */
export function verifierSignature(req: Request, _res: Response, next: NextFunction) {
  const fichiers = [
    ...(req.file ? [req.file] : []),
    ...(Array.isArray(req.files) ? req.files : []),
  ];
  for (const f of fichiers) {
    const reel = typeReel(f.buffer);
    if (!reel) return next(new AppError(`Contenu de fichier non reconnu : ${f.originalname}`, 415));
    if (!ALLOWED_MIME.has(reel)) return next(new AppError(`Type de fichier non autorisé : ${reel}`, 415));
    // Le mimetype servi plus tard est celui des octets, pas celui déclaré.
    f.mimetype = reel;
  }
  next();
}
