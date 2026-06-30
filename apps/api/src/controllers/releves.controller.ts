import { Request, Response, NextFunction } from 'express';
import { parseISO } from 'date-fns';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { paginate } from '../utils/paginator';
import { auditLog } from '../services/audit.service';
import { buildXlsx, setXlsxHeaders } from '../utils/excel';
import { GE_PARAMS } from '../utils/calculator';

/** Estime le coût d'un relevé selon la source (gasoil pour GE, kWh CEET sinon). */
function estimerCout(data: Record<string, any>): number | null {
  if (data.coutEstime != null) return Math.round(Number(data.coutEstime));
  if (data.source === 'GE' && data.volumeGasoilLitres != null) {
    return Math.round(Number(data.volumeGasoilLitres) * GE_PARAMS.prixLitreFCFA);
  }
  if (data.source === 'CEET' && data.consommationKwh != null) {
    // Tarif CEET indicatif (FCFA/kWh) — paramétrable côté SystemSettings
    return Math.round(Number(data.consommationKwh) * 105);
  }
  return null;
}

export async function getReleves(req: Request, res: Response, next: NextFunction) {
  try {
    const { site_id, source, date_debut, date_fin, page = '1', limit = '20' } =
      req.query as Record<string, string>;

    const where: Record<string, unknown> = {};
    if (site_id) where.siteId = site_id;
    if (source) where.source = source;
    if (date_debut || date_fin) {
      where.dateReleve = {
        ...(date_debut ? { gte: parseISO(date_debut) } : {}),
        ...(date_fin ? { lte: parseISO(date_fin) } : {}),
      };
    }

    const { data, meta } = await paginate(
      prisma.releveEnergie,
      {
        where,
        orderBy: { dateReleve: 'desc' },
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

export async function getReleveById(req: Request, res: Response, next: NextFunction) {
  try {
    const releve = await prisma.releveEnergie.findUnique({
      where: { id: req.params.id },
      include: {
        site: true,
        technicien: { select: { nom: true, prenom: true } },
        groupe: { select: { numero: true, puissanceKva: true } },
        maintenance: { select: { id: true, type: true, categorie: true, equipement: true, dateFin: true } },
      },
    });
    if (!releve) throw new AppError('Relevé introuvable', 404);
    res.json({ success: true, data: releve });
  } catch (err) { next(err); }
}

export async function createReleve(req: Request, res: Response, next: NextFunction) {
  try {
    const coutEstime = estimerCout(req.body);
    const releve = await prisma.releveEnergie.create({
      data: {
        ...req.body,
        dateReleve: req.body.dateReleve ? new Date(req.body.dateReleve) : new Date(),
        technicienId: req.body.technicienId ?? req.user!.id,
        coutEstime,
      },
    });
    await auditLog(req.user!.id, 'CREATE', 'releves', releve.id, req.body, req);
    res.status(201).json({ success: true, data: releve });
  } catch (err) { next(err); }
}

export async function exportReleves(req: Request, res: Response, next: NextFunction) {
  try {
    const { site_id, source } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (site_id) where.siteId = site_id;
    if (source) where.source = source;

    const rows = await prisma.releveEnergie.findMany({
      where,
      orderBy: { dateReleve: 'desc' },
      include: { site: { select: { code: true } } },
    });

    const buffer = await buildXlsx(
      'Releves',
      [
        { header: 'Site', key: 'site', width: 16 },
        { header: 'Date', key: 'date', width: 18 },
        { header: 'Source', key: 'source', width: 10 },
        { header: 'Index compteur', key: 'index', width: 14 },
        { header: 'Conso (kWh)', key: 'kwh', width: 12 },
        { header: 'Gasoil (L)', key: 'gasoil', width: 12 },
        { header: 'Heures GE', key: 'heures', width: 10 },
        { header: 'Coût estimé', key: 'cout', width: 14 },
      ],
      rows.map((r) => ({
        site: r.site?.code ?? '',
        date: r.dateReleve.toLocaleString('fr-FR'),
        source: r.source,
        index: r.indexCompteur != null ? Number(r.indexCompteur) : '',
        kwh: r.consommationKwh != null ? Number(r.consommationKwh) : '',
        gasoil: r.volumeGasoilLitres != null ? Number(r.volumeGasoilLitres) : '',
        heures: r.heuresFonctGE != null ? Number(r.heuresFonctGE) : '',
        cout: r.coutEstime != null ? Number(r.coutEstime) : '',
      }))
    );

    await auditLog(req.user!.id, 'EXPORT', 'releves', undefined, { count: rows.length }, req);
    setXlsxHeaders(res, 'releves.xlsx');
    res.send(buffer);
  } catch (err) { next(err); }
}
