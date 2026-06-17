import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { paginate } from '../utils/paginator';
import { auditLog } from '../services/audit.service';
import { cacheService } from '../services/cache.service';
import { calculerStockSite } from '../utils/calculator';
import { buildXlsx, setXlsxHeaders } from '../utils/excel';

/**
 * @swagger
 * /sites:
 *   get:
 *     tags: [Sites]
 *     summary: Liste des sites avec filtres et pagination
 */
export async function getSites(req: Request, res: Response, next: NextFunction) {
  try {
    const { region, statut_ge, power_config, search, page = '1', limit = '20', sort = 'nom' } = req.query as Record<string, string>;

    const where: Record<string, unknown> = { isActive: true };
    if (region) where.region = region;
    if (statut_ge) where.statutGE = statut_ge;
    if (power_config) where.powerConfig = power_config;
    if (search) where.OR = [
      { nom: { contains: search, mode: 'insensitive' } },
      { code: { contains: search, mode: 'insensitive' } },
    ];

    const { data, meta } = await paginate(
      prisma.site,
      { where, orderBy: { [sort]: 'asc' } },
      { page: parseInt(page), limit: parseInt(limit) }
    );

    res.json({ success: true, data, meta });
  } catch (err) { next(err); }
}

export async function getSiteById(req: Request, res: Response, next: NextFunction) {
  try {
    const site = await prisma.site.findUnique({
      where: { id: req.params.id },
      include: {
        lot: {
          include: {
            assignments: {
              include: { prestataire: { select: { id: true, nom: true, telephone: true } } },
              orderBy: { scope: 'asc' },
            },
          },
        },
      },
    });
    if (!site) throw new AppError('Site introuvable', 404);
    res.json({ success: true, data: site });
  } catch (err) { next(err); }
}

export async function createSite(req: Request, res: Response, next: NextFunction) {
  try {
    const site = await prisma.site.create({ data: req.body });
    await auditLog(req.user!.id, 'CREATE', 'sites', site.id, req.body, req);
    await cacheService.invalidate('sites:geojson');
    res.status(201).json({ success: true, data: site });
  } catch (err) { next(err); }
}

export async function updateSite(req: Request, res: Response, next: NextFunction) {
  try {
    const site = await prisma.site.findUnique({ where: { id: req.params.id } });
    if (!site) throw new AppError('Site introuvable', 404);
    const updated = await prisma.site.update({ where: { id: req.params.id }, data: req.body });
    await auditLog(req.user!.id, 'UPDATE', 'sites', site.id, { before: site, after: req.body }, req);
    await cacheService.invalidate('sites:geojson');
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

export async function deleteSite(req: Request, res: Response, next: NextFunction) {
  try {
    const site = await prisma.site.findUnique({ where: { id: req.params.id } });
    if (!site) throw new AppError('Site introuvable', 404);
    await prisma.site.update({ where: { id: req.params.id }, data: { isActive: false } });
    await auditLog(req.user!.id, 'DELETE', 'sites', site.id, {}, req);
    res.json({ success: true, message: 'Site désactivé' });
  } catch (err) { next(err); }
}

/** GeoJSON pour Leaflet — avec mise en cache Redis 5min */
export async function getSitesGeoJSON(req: Request, res: Response, next: NextFunction) {
  try {
    const cacheKey = 'sites:geojson';
    const cached = await cacheService.get(cacheKey);
    if (cached) return res.json(cached);

    const sites = await prisma.site.findMany({
      where: { isActive: true, latitude: { not: null }, longitude: { not: null } },
      select: { id: true, nom: true, code: true, region: true, statutGE: true, powerConfig: true, puissanceGEkva: true, latitude: true, longitude: true },
    });

    // Récupérer le dernier stock pour chaque site
    const stocks = await prisma.releveEnergie.groupBy({
      by: ['siteId'],
      _max: { createdAt: true },
    });
    const stockMap = new Map(stocks.map(s => [s.siteId, s]));

    const geojson = {
      type: 'FeatureCollection',
      features: sites.map(site => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [Number(site.longitude), Number(site.latitude)] },
        properties: {
          id: site.id, nom: site.nom, code: site.code, region: site.region,
          statutGE: site.statutGE, powerConfig: site.powerConfig,
          puissanceGEkva: Number(site.puissanceGEkva),
          hasStock: stockMap.has(site.id),
        },
      })),
    };

    await cacheService.set(cacheKey, geojson, 300); // 5 min
    res.json(geojson);
  } catch (err) { next(err); }
}

/** Stock actuel d'un site (dernier relevé gasoil) */
export async function getSiteStock(req: Request, res: Response, next: NextFunction) {
  try {
    const site = await prisma.site.findUnique({ where: { id: req.params.id } });
    if (!site) throw new AppError('Site introuvable', 404);

    const dernierReleve = await prisma.releveEnergie.findFirst({
      where: { siteId: req.params.id, source: 'GE' },
      orderBy: { dateReleve: 'desc' },
    });

    const stock = calculerStockSite(site, dernierReleve);
    res.json({ success: true, data: stock });
  } catch (err) { next(err); }
}

export async function getSiteMaintenances(req: Request, res: Response, next: NextFunction) {
  try {
    const { page = '1', limit = '20' } = req.query as Record<string, string>;
    const { data, meta } = await paginate(
      prisma.maintenance,
      { where: { siteId: req.params.id }, orderBy: { datePlanifiee: 'desc' }, include: { technicien: { select: { nom: true, prenom: true } } } },
      { page: parseInt(page), limit: parseInt(limit) }
    );
    res.json({ success: true, data, meta });
  } catch (err) { next(err); }
}

export async function getSiteDepotages(req: Request, res: Response, next: NextFunction) {
  try {
    const { page = '1', limit = '20' } = req.query as Record<string, string>;
    const { data, meta } = await paginate(
      prisma.depotage,
      { where: { siteId: req.params.id }, orderBy: { dateDepotage: 'desc' } },
      { page: parseInt(page), limit: parseInt(limit) }
    );
    res.json({ success: true, data, meta });
  } catch (err) { next(err); }
}

export async function getSiteIncidents(req: Request, res: Response, next: NextFunction) {
  try {
    const { page = '1', limit = '20' } = req.query as Record<string, string>;
    const { data, meta } = await paginate(
      prisma.incident,
      { where: { siteId: req.params.id }, orderBy: { dateOuverture: 'desc' } },
      { page: parseInt(page), limit: parseInt(limit) }
    );
    res.json({ success: true, data, meta });
  } catch (err) { next(err); }
}

export async function getSiteReleves(req: Request, res: Response, next: NextFunction) {
  try {
    const { page = '1', limit = '20', source } = req.query as Record<string, string>;
    const where: Record<string, unknown> = { siteId: req.params.id };
    if (source) where.source = source;
    const { data, meta } = await paginate(
      prisma.releveEnergie,
      { where, orderBy: { dateReleve: 'desc' } },
      { page: parseInt(page), limit: parseInt(limit) }
    );
    res.json({ success: true, data, meta });
  } catch (err) { next(err); }
}

/** Export Excel de la liste des sites (avec filtres identiques à getSites). */
export async function exportSites(req: Request, res: Response, next: NextFunction) {
  try {
    const { region, statut_ge, power_config } = req.query as Record<string, string>;
    const where: Record<string, unknown> = { isActive: true };
    if (region) where.region = region;
    if (statut_ge) where.statutGE = statut_ge;
    if (power_config) where.powerConfig = power_config;

    const sites = await prisma.site.findMany({ where, orderBy: { code: 'asc' } });

    const buffer = await buildXlsx(
      'Sites',
      [
        { header: 'Code', key: 'code', width: 14 },
        { header: 'Nom', key: 'nom', width: 26 },
        { header: 'Région', key: 'region', width: 14 },
        { header: 'Ville', key: 'ville', width: 16 },
        { header: 'Config énergie', key: 'powerConfig', width: 18 },
        { header: 'Statut GE', key: 'statutGE', width: 14 },
        { header: 'Puissance GE (kVA)', key: 'puissance', width: 16 },
        { header: 'Latitude', key: 'lat', width: 12 },
        { header: 'Longitude', key: 'lng', width: 12 },
      ],
      sites.map((s) => ({
        code: s.code,
        nom: s.nom,
        region: s.region,
        ville: s.ville ?? '',
        powerConfig: s.powerConfig,
        statutGE: s.statutGE,
        puissance: Number(s.puissanceGEkva),
        lat: s.latitude != null ? Number(s.latitude) : '',
        lng: s.longitude != null ? Number(s.longitude) : '',
      }))
    );

    await auditLog(req.user!.id, 'EXPORT', 'sites', undefined, { count: sites.length }, req);
    setXlsxHeaders(res, 'sites.xlsx');
    res.send(buffer);
  } catch (err) { next(err); }
}
