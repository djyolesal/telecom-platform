import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { uploadBuffer } from '../services/storage.service';

/**
 * Upload d'une image (photo terrain, signature). Si entityType/entityId sont fournis,
 * un enregistrement Photo est créé et rattaché à l'entité.
 */
export async function uploadImage(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) throw new AppError('Aucun fichier reçu', 400);
    const { entityType, entityId, folder } = req.body as Record<string, string>;

    const stored = await uploadBuffer(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      folder || 'photos'
    );

    if (entityType && entityId) {
      await prisma.photo.create({
        data: { entityType, entityId, url: stored.url, minioKey: stored.key },
      });
    }

    res.status(201).json({ success: true, data: stored });
  } catch (err) { next(err); }
}

/** Upload d'un document (PDF, bon de livraison). */
export async function uploadDocument(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) throw new AppError('Aucun fichier reçu', 400);
    const stored = await uploadBuffer(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      req.body.folder || 'documents'
    );
    res.status(201).json({ success: true, data: stored });
  } catch (err) { next(err); }
}
