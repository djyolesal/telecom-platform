import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { uploadBuffer } from '../services/storage.service';

// Dossiers de destination autorisés (empêche l'écriture sous un préfixe choisi
// par le client, ex. « rapports »). Le client ne peut viser que ces zones.
const FOLDERS_AUTORISES = new Set(['photos', 'signatures', 'documents', 'logos']);
const folderSafe = (f: unknown, defaut: string): string =>
  typeof f === 'string' && FOLDERS_AUTORISES.has(f) ? f : defaut;

// Entités auxquelles une photo peut être rattachée + table Prisma correspondante.
const ENTITES_PHOTO: Record<string, () => { findUnique: (a: { where: { id: string } }) => Promise<unknown> }> = {
  maintenance: () => prisma.maintenance,
  incident: () => prisma.incident,
  depotage: () => prisma.depotage,
};

/**
 * Upload d'une image (photo terrain, signature). Si entityType/entityId sont
 * fournis, un Photo est créé — mais SEULEMENT après avoir vérifié que le type
 * est connu et que l'entité existe réellement (anti-rattachement arbitraire).
 */
export async function uploadImage(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) throw new AppError('Aucun fichier reçu', 400);
    const { entityType, entityId, folder } = req.body as Record<string, string>;

    if (entityType || entityId) {
      const resolver = ENTITES_PHOTO[entityType];
      if (!resolver || !entityId) throw new AppError('Rattachement de photo invalide.', 400);
      const exists = await resolver().findUnique({ where: { id: entityId } });
      if (!exists) throw new AppError('Entité cible introuvable pour la photo.', 404);
    }

    const stored = await uploadBuffer(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      folderSafe(folder, 'photos')
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
      folderSafe(req.body.folder, 'documents')
    );
    res.status(201).json({ success: true, data: stored });
  } catch (err) { next(err); }
}
