import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { paginate } from '../utils/paginator';
import { auditLog } from '../services/audit.service';

const SCOPES = ['PASSIVE', 'ACTIVE', 'LES_DEUX', 'SOLAIRE'];

const assignmentInclude = {
  assignments: {
    include: { prestataire: { select: { id: true, nom: true } } },
    orderBy: { scope: 'asc' as const },
  },
};

export async function getLots(req: Request, res: Response, next: NextFunction) {
  try {
    const { search, region, page = '1', limit = '20' } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (region) where.region = region;
    if (search) where.OR = [
      { code: { contains: search, mode: 'insensitive' } },
      { nom: { contains: search, mode: 'insensitive' } },
    ];

    const { data, meta } = await paginate(
      prisma.lot,
      {
        where,
        orderBy: { code: 'asc' },
        include: { ...assignmentInclude, _count: { select: { sites: true, sitesSolaires: true } } },
      },
      { page: parseInt(page), limit: parseInt(limit) }
    );
    res.json({ success: true, data, meta });
  } catch (err) { next(err); }
}

export async function getLotById(req: Request, res: Response, next: NextFunction) {
  try {
    const lot = await prisma.lot.findUnique({
      where: { id: req.params.id },
      include: {
        ...assignmentInclude,
        sites: { select: { id: true, code: true, nom: true, region: true }, orderBy: { code: 'asc' } },
        sitesSolaires: { select: { id: true, code: true, nom: true, region: true }, orderBy: { code: 'asc' } },
      },
    });
    if (!lot) throw new AppError('Lot introuvable', 404);
    res.json({ success: true, data: lot });
  } catch (err) { next(err); }
}

export async function createLot(req: Request, res: Response, next: NextFunction) {
  try {
    const { code, nom, region, contrat } = req.body;
    if (!code || !nom) throw new AppError('Code et nom requis', 400);
    // Type de contrat figé à la création : les lots SOLAIRES sont un
    // découpage de parc distinct des lots passifs/actifs.
    const c = contrat === 'SOLAIRE' ? 'SOLAIRE' : 'PASSIF_ACTIF';
    const lot = await prisma.lot.create({ data: { code, nom, region, contrat: c } });
    await auditLog(req.user!.id, 'CREATE', 'lots', lot.id, { code }, req);
    res.status(201).json({ success: true, data: lot });
  } catch (err) { next(err); }
}

export async function updateLot(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.lot.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Lot introuvable', 404);
    const { code, nom, region } = req.body;
    const updated = await prisma.lot.update({ where: { id: req.params.id }, data: { code, nom, region } });
    await auditLog(req.user!.id, 'UPDATE', 'lots', existing.id, req.body, req);
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

export async function deleteLot(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.lot.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Lot introuvable', 404);
    // Les sites sont détachés (lotId → null via FK), les attributions supprimées (cascade).
    await prisma.lot.delete({ where: { id: req.params.id } });
    await auditLog(req.user!.id, 'DELETE', 'lots', existing.id, {}, req);
    res.json({ success: true, message: 'Lot supprimé' });
  } catch (err) { next(err); }
}

// ── Attributions (prestataire + périmètre) ───────────────────
export async function addAssignment(req: Request, res: Response, next: NextFunction) {
  try {
    const { prestataireId, scope, dateDebut, dateFin } = req.body;
    if (!prestataireId || !SCOPES.includes(scope)) {
      throw new AppError('prestataireId et scope (PASSIVE|ACTIVE|LES_DEUX|SOLAIRE) requis', 400);
    }
    // Cohérence contrat ↔ scope : une attribution SOLAIRE ne se pose que sur
    // un lot SOLAIRE, et réciproquement — sinon l'imputation des visites et
    // le périmètre du prestataire deviendraient ambigus.
    const lotCible = await prisma.lot.findUnique({ where: { id: req.params.id }, select: { contrat: true } });
    if (!lotCible) throw new AppError('Lot introuvable', 404);
    if (lotCible.contrat === 'SOLAIRE' && scope !== 'SOLAIRE') {
      throw new AppError('Ce lot est SOLAIRE : seule une attribution SOLAIRE peut s\'y poser', 422);
    }
    if (lotCible.contrat !== 'SOLAIRE' && scope === 'SOLAIRE') {
      throw new AppError('Attribution SOLAIRE réservée aux lots de contrat SOLAIRE (créez un lot solaire)', 422);
    }
    const lot = await prisma.lot.findUnique({ where: { id: req.params.id } });
    if (!lot) throw new AppError('Lot introuvable', 404);

    const assignment = await prisma.lotAssignment.create({
      data: {
        lotId: req.params.id,
        prestataireId,
        scope,
        dateDebut: dateDebut ? new Date(dateDebut) : undefined,
        dateFin: dateFin ? new Date(dateFin) : undefined,
      },
      include: { prestataire: { select: { id: true, nom: true } } },
    });
    await auditLog(req.user!.id, 'ASSIGN', 'lots', lot.id, { prestataireId, scope }, req);
    res.status(201).json({ success: true, data: assignment });
  } catch (err) { next(err); }
}

export async function removeAssignment(req: Request, res: Response, next: NextFunction) {
  try {
    const assignment = await prisma.lotAssignment.findUnique({ where: { id: req.params.assignmentId } });
    if (!assignment || assignment.lotId !== req.params.id) throw new AppError('Attribution introuvable', 404);
    await prisma.lotAssignment.delete({ where: { id: req.params.assignmentId } });
    await auditLog(req.user!.id, 'DELETE', 'lot_assignments', req.params.assignmentId, {}, req);
    res.json({ success: true, message: 'Attribution retirée' });
  } catch (err) { next(err); }
}

// ── Affectation des sites au lot ─────────────────────────────
export async function assignSites(req: Request, res: Response, next: NextFunction) {
  try {
    const { siteIds } = req.body as { siteIds: string[] };
    if (!Array.isArray(siteIds) || siteIds.length === 0) throw new AppError('Liste de sites requise', 400);
    const lot = await prisma.lot.findUnique({ where: { id: req.params.id } });
    if (!lot) throw new AppError('Lot introuvable', 404);

    const result = await prisma.site.updateMany({
      where: { id: { in: siteIds } },
      data: { lotId: req.params.id },
    });
    await auditLog(req.user!.id, 'UPDATE', 'lots', lot.id, { sitesAffectes: result.count }, req);
    res.json({ success: true, data: { affectes: result.count } });
  } catch (err) { next(err); }
}

export async function removeSite(req: Request, res: Response, next: NextFunction) {
  try {
    const site = await prisma.site.findUnique({ where: { id: req.params.siteId } });
    if (!site || site.lotId !== req.params.id) throw new AppError('Site non rattaché à ce lot', 404);
    await prisma.site.update({ where: { id: req.params.siteId }, data: { lotId: null } });
    await auditLog(req.user!.id, 'UPDATE', 'lots', req.params.id, { siteRetire: req.params.siteId }, req);
    res.json({ success: true, message: 'Site retiré du lot' });
  } catch (err) { next(err); }
}
