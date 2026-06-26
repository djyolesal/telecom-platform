import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { paginate } from '../utils/paginator';
import { auditLog } from '../services/audit.service';

export async function getPrestataires(req: Request, res: Response, next: NextFunction) {
  try {
    const { search, is_active, page = '1', limit = '20' } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (is_active != null) where.isActive = is_active === 'true';
    if (search) where.OR = [
      { nom: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];

    const { data, meta } = await paginate(
      prisma.prestataire,
      { where, orderBy: { nom: 'asc' }, include: { _count: { select: { assignments: true } } } },
      { page: parseInt(page), limit: parseInt(limit) }
    );
    res.json({ success: true, data, meta });
  } catch (err) { next(err); }
}

export async function getPrestataireById(req: Request, res: Response, next: NextFunction) {
  try {
    const prestataire = await prisma.prestataire.findUnique({
      where: { id: req.params.id },
      include: {
        assignments: {
          include: { lot: { select: { id: true, code: true, nom: true, region: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!prestataire) throw new AppError('Prestataire introuvable', 404);
    res.json({ success: true, data: prestataire });
  } catch (err) { next(err); }
}

export async function createPrestataire(req: Request, res: Response, next: NextFunction) {
  try {
    const { nom, email, adresse, rccm, nif, contactCommercial, contactTechnique, logoPath } = req.body;
    if (!nom) throw new AppError('Le nom est requis', 400);
    const prestataire = await prisma.prestataire.create({ data: { nom, email, adresse, rccm, nif, contactCommercial, contactTechnique, logoPath } });
    await auditLog(req.user!.id, 'CREATE', 'prestataires', prestataire.id, { nom }, req);
    res.status(201).json({ success: true, data: prestataire });
  } catch (err) { next(err); }
}

export async function updatePrestataire(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.prestataire.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Prestataire introuvable', 404);
    const { nom, email, isActive, adresse, rccm, nif, contactCommercial, contactTechnique, logoPath } = req.body;
    const updated = await prisma.prestataire.update({
      where: { id: req.params.id },
      data: { nom, email, isActive, adresse, rccm, nif, contactCommercial, contactTechnique, logoPath },
    });
    await auditLog(req.user!.id, 'UPDATE', 'prestataires', existing.id, req.body, req);
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

export async function togglePrestataire(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.prestataire.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Prestataire introuvable', 404);
    const updated = await prisma.prestataire.update({
      where: { id: req.params.id },
      data: { isActive: !existing.isActive },
    });
    await auditLog(req.user!.id, 'UPDATE', 'prestataires', existing.id, { isActive: updated.isActive }, req);
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

export async function deletePrestataire(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.prestataire.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { assignments: true } } },
    });
    if (!existing) throw new AppError('Prestataire introuvable', 404);
    if (existing._count.assignments > 0) {
      throw new AppError('Impossible de supprimer : ce prestataire a des lots attribués. Désactivez-le plutôt.', 409);
    }
    await prisma.prestataire.delete({ where: { id: req.params.id } });
    await auditLog(req.user!.id, 'DELETE', 'prestataires', existing.id, {}, req);
    res.json({ success: true, message: 'Prestataire supprimé' });
  } catch (err) { next(err); }
}
