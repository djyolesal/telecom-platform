import { Request, Response, NextFunction } from 'express';
import { parseISO } from 'date-fns';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { paginate } from '../utils/paginator';
import { auditLog } from '../services/audit.service';
import { buildXlsx, setXlsxHeaders } from '../utils/excel';
import { io } from '../server';

/** Calcule coût total et stock après dépotage à partir des entrées. */
function computeDepotage(data: Record<string, any>) {
  const volume = Number(data.volumeLitres) || 0;
  const prix = data.prixLitre != null ? Number(data.prixLitre) : null;
  const stockAvant = data.stockAvantLitres != null ? Number(data.stockAvantLitres) : null;

  const coutTotal = prix != null ? Math.round(volume * prix) : data.coutTotal ?? null;
  const stockApres =
    data.stockApresLitres != null
      ? Number(data.stockApresLitres)
      : stockAvant != null
        ? stockAvant + volume
        : null;

  return { coutTotal, stockApres };
}

export async function getDepotages(req: Request, res: Response, next: NextFunction) {
  try {
    const { site_id, fournisseur, date_debut, date_fin, page = '1', limit = '20' } =
      req.query as Record<string, string>;

    const where: Record<string, unknown> = {};
    if (site_id) where.siteId = site_id;
    if (fournisseur) where.fournisseur = { contains: fournisseur, mode: 'insensitive' };
    if (date_debut || date_fin) {
      where.dateDepotage = {
        ...(date_debut ? { gte: parseISO(date_debut) } : {}),
        ...(date_fin ? { lte: parseISO(date_fin) } : {}),
      };
    }

    const { data, meta } = await paginate(
      prisma.depotage,
      {
        where,
        orderBy: { dateDepotage: 'desc' },
        include: {
          site: { select: { nom: true, code: true, region: true } },
          technicien: { select: { nom: true, prenom: true } },
        },
      },
      { page: parseInt(page), limit: parseInt(limit) }
    );

    res.json({ success: true, data, meta });
  } catch (err) { next(err); }
}

export async function getDepotageById(req: Request, res: Response, next: NextFunction) {
  try {
    const depotage = await prisma.depotage.findUnique({
      where: { id: req.params.id },
      include: { site: true, technicien: { select: { nom: true, prenom: true } } },
    });
    if (!depotage) throw new AppError('Dépotage introuvable', 404);
    res.json({ success: true, data: depotage });
  } catch (err) { next(err); }
}

export async function createDepotage(req: Request, res: Response, next: NextFunction) {
  try {
    const { coutTotal, stockApres } = computeDepotage(req.body);
    const depotage = await prisma.depotage.create({
      data: {
        ...req.body,
        dateDepotage: req.body.dateDepotage ? new Date(req.body.dateDepotage) : new Date(),
        technicienId: req.body.technicienId ?? req.user!.id,
        coutTotal,
        stockApresLitres: stockApres,
      },
      include: { site: { select: { code: true, nom: true } } },
    });

    await auditLog(req.user!.id, 'CREATE', 'depotages', depotage.id, req.body, req);
    io.of('/supervision').emit('stock:updated', {
      siteId: depotage.siteId,
      siteCode: depotage.site?.code,
      stockApresLitres: stockApres,
      volumeLitres: Number(depotage.volumeLitres),
    });

    res.status(201).json({ success: true, data: depotage });
  } catch (err) { next(err); }
}

export async function updateDepotage(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.depotage.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Dépotage introuvable', 404);

    const { site: _s, technicien: _t, ...data } = req.body;
    const { coutTotal, stockApres } = computeDepotage({ ...existing, ...data });
    if (data.dateDepotage) data.dateDepotage = new Date(data.dateDepotage);

    const updated = await prisma.depotage.update({
      where: { id: req.params.id },
      data: { ...data, coutTotal, stockApresLitres: stockApres },
    });
    await auditLog(req.user!.id, 'UPDATE', 'depotages', existing.id, data, req);
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

export async function deleteDepotage(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.depotage.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Dépotage introuvable', 404);
    await prisma.depotage.delete({ where: { id: req.params.id } });
    await auditLog(req.user!.id, 'DELETE', 'depotages', existing.id, {}, req);
    res.json({ success: true, message: 'Dépotage supprimé' });
  } catch (err) { next(err); }
}

export async function exportDepotages(req: Request, res: Response, next: NextFunction) {
  try {
    const { site_id, fournisseur } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (site_id) where.siteId = site_id;
    if (fournisseur) where.fournisseur = { contains: fournisseur, mode: 'insensitive' };

    const rows = await prisma.depotage.findMany({
      where,
      orderBy: { dateDepotage: 'desc' },
      include: { site: { select: { code: true } } },
    });

    const buffer = await buildXlsx(
      'Depotages',
      [
        { header: 'Site', key: 'site', width: 16 },
        { header: 'Date', key: 'date', width: 18 },
        { header: 'Volume (L)', key: 'volume', width: 12 },
        { header: 'Stock après (L)', key: 'stockApres', width: 14 },
        { header: 'Fournisseur', key: 'fournisseur', width: 20 },
        { header: 'Bon livraison', key: 'bl', width: 18 },
        { header: 'Prix/L', key: 'prix', width: 10 },
        { header: 'Coût total', key: 'cout', width: 14 },
      ],
      rows.map((d) => ({
        site: d.site?.code ?? '',
        date: d.dateDepotage.toLocaleString('fr-FR'),
        volume: Number(d.volumeLitres),
        stockApres: d.stockApresLitres != null ? Number(d.stockApresLitres) : '',
        fournisseur: d.fournisseur ?? '',
        bl: d.numeroBonLivraison ?? '',
        prix: d.prixLitre != null ? Number(d.prixLitre) : '',
        cout: d.coutTotal != null ? Number(d.coutTotal) : '',
      }))
    );

    await auditLog(req.user!.id, 'EXPORT', 'depotages', undefined, { count: rows.length }, req);
    setXlsxHeaders(res, 'depotages.xlsx');
    res.send(buffer);
  } catch (err) { next(err); }
}
