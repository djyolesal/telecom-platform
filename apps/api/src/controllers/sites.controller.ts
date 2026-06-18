import { Request, Response, NextFunction } from 'express';
import ExcelJS from 'exceljs';
import { PowerConfig, StatutGE } from '@prisma/client';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { paginate } from '../utils/paginator';
import { auditLog } from '../services/audit.service';
import { cacheService } from '../services/cache.service';
import { calculerStockSite } from '../utils/calculator';
import { buildXlsx, setXlsxHeaders } from '../utils/excel';

// Colonnes du modèle d'import / export (en-têtes normalisés → champ).
const IMPORT_COLUMNS = [
  { key: 'code', header: 'code' },
  { key: 'nom', header: 'nom' },
  { key: 'region', header: 'region' },
  { key: 'ville', header: 'ville' },
  { key: 'adresse', header: 'adresse' },
  { key: 'latitude', header: 'latitude' },
  { key: 'longitude', header: 'longitude' },
  { key: 'powerConfig', header: 'powerConfig' },
  { key: 'statutGE', header: 'statutGE' },
  { key: 'puissanceGEkva', header: 'puissanceGEkva' },
  { key: 'lot', header: 'lot' },
];

// Normalise un en-tête : minuscules, sans accents ni séparateurs.
const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

// Synonymes acceptés (normalisés) → champ Site.
const HEADER_ALIASES: Record<string, string> = {
  code: 'code',
  nom: 'nom', name: 'nom',
  region: 'region',
  ville: 'ville', city: 'ville',
  adresse: 'adresse', address: 'adresse',
  latitude: 'latitude', lat: 'latitude',
  longitude: 'longitude', lng: 'longitude', lon: 'longitude',
  powerconfig: 'powerConfig', configenergie: 'powerConfig', configurationenergie: 'powerConfig',
  statutge: 'statutGE',
  puissancegekva: 'puissanceGEkva', puissancekva: 'puissanceGEkva', kva: 'puissanceGEkva',
  lot: 'lot', codelot: 'lot', lotcode: 'lot',
};

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
    await cacheService.invalidate('sites:geojson');
    res.json({ success: true, message: 'Site désactivé' });
  } catch (err) { next(err); }
}

/** Modèle xlsx d'import (en-têtes + une ligne d'exemple). */
export async function sitesImportTemplate(_req: Request, res: Response, next: NextFunction) {
  try {
    const buffer = await buildXlsx('Sites', IMPORT_COLUMNS, [
      {
        code: 'MAR-001', nom: 'Site Exemple', region: 'Maritime', ville: 'Lomé',
        adresse: 'Quartier X', latitude: 6.1725, longitude: 1.2314,
        powerConfig: 'CEET_GE', statutGE: 'GE_SECOURS', puissanceGEkva: 100, lot: 'LOT-01',
      },
    ]);
    setXlsxHeaders(res, 'modele_import_sites.xlsx');
    res.send(buffer);
  } catch (err) { next(err); }
}

/**
 * Import en masse de sites depuis un .xlsx. Upsert par `code` :
 * code existant → mise à jour, sinon création. Renvoie un récapitulatif.
 */
export async function importSites(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) throw new AppError('Aucun fichier reçu (champ "file").', 400);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.file.buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws || ws.rowCount < 2) throw new AppError('Fichier vide ou sans données.', 400);

    // En-têtes (ligne 1) → index de colonne par champ Site.
    const colByField: Record<string, number> = {};
    ws.getRow(1).eachCell((cell, col) => {
      const field = HEADER_ALIASES[norm(String(cell.value ?? ''))];
      if (field) colByField[field] = col;
    });
    if (colByField.code == null) {
      throw new AppError('Colonne "code" introuvable. Utilisez le modèle d\'import.', 422);
    }

    const POWER = Object.values(PowerConfig) as string[];
    const STATUT = Object.values(StatutGE) as string[];

    // Préchargement des lots pour résoudre le rattachement (par code, puis nom).
    const lots = await prisma.lot.findMany({ select: { id: true, code: true, nom: true } });
    const lotByKey = new Map<string, string>();
    for (const l of lots) {
      lotByKey.set(norm(l.code), l.id);
      lotByKey.set(norm(l.nom), l.id);
    }
    const cellText = (row: ExcelJS.Row, field: string): string => {
      const col = colByField[field];
      if (col == null) return '';
      return String(row.getCell(col).text ?? '').trim();
    };
    const numOrNull = (v: string): number | null => (v === '' || Number.isNaN(Number(v)) ? null : Number(v));

    const results = { total: 0, created: 0, updated: 0, errors: [] as { ligne: number; code: string; message: string }[] };

    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const code = cellText(row, 'code');
      // Ligne entièrement vide → on ignore.
      if (!code && !cellText(row, 'nom')) continue;
      results.total++;
      try {
        if (!code) throw new Error('code manquant');
        const nom = cellText(row, 'nom');
        const region = cellText(row, 'region');
        if (!nom) throw new Error('nom manquant');
        if (!region) throw new Error('region manquante');

        const powerConfig = cellText(row, 'powerConfig') || 'CEET_GE';
        if (!POWER.includes(powerConfig)) throw new Error(`powerConfig invalide « ${powerConfig} » (attendu : ${POWER.join(', ')})`);
        const statutGE = cellText(row, 'statutGE') || 'GE_SECOURS';
        if (!STATUT.includes(statutGE)) throw new Error(`statutGE invalide « ${statutGE} » (attendu : ${STATUT.join(', ')})`);

        // Rattachement au lot (optionnel). Colonne vide → lotId inchangé (préservé en update).
        let lotId: string | undefined;
        const lotRef = cellText(row, 'lot');
        if (lotRef) {
          lotId = lotByKey.get(norm(lotRef));
          if (!lotId) throw new Error(`lot introuvable « ${lotRef} » (code de lot attendu)`);
        }

        const data = {
          nom,
          region,
          ville: cellText(row, 'ville') || null,
          adresse: cellText(row, 'adresse') || null,
          latitude: numOrNull(cellText(row, 'latitude')),
          longitude: numOrNull(cellText(row, 'longitude')),
          powerConfig: powerConfig as PowerConfig,
          statutGE: statutGE as StatutGE,
          puissanceGEkva: numOrNull(cellText(row, 'puissanceGEkva')) ?? 0,
          lotId,
          isActive: true,
        };

        const existing = await prisma.site.findUnique({ where: { code } });
        if (existing) {
          await prisma.site.update({ where: { code }, data });
          results.updated++;
        } else {
          await prisma.site.create({ data: { ...data, code } });
          results.created++;
        }
      } catch (e) {
        results.errors.push({ ligne: r, code, message: e instanceof Error ? e.message : 'Erreur inconnue' });
      }
    }

    await auditLog(req.user!.id, 'CREATE', 'sites', 'bulk-import', { fichier: req.file.originalname, ...results }, req);
    await cacheService.invalidate('sites:geojson');
    res.json({ success: true, data: results });
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
