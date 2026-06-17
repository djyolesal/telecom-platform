import { Request, Response, NextFunction } from 'express';
import { ScopeMaintenance, SourceEnergie, Prisma } from '@prisma/client';
import { differenceInMinutes, startOfWeek, endOfWeek, parseISO } from 'date-fns';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { paginate } from '../utils/paginator';
import { auditLog } from '../services/audit.service';
import { generateMaintenancePdf } from '../services/pdf.service';
import { uploadBuffer } from '../services/storage.service';
import { buildXlsx, setXlsxHeaders } from '../utils/excel';
import { GE_PARAMS } from '../utils/calculator';

const techInclude = { technicien: { select: { nom: true, prenom: true } } };

// Catégories d'équipement → nature de maintenance (passive = infra/énergie, active = télécom).
const PASSIVE_CATS = ['GE', 'BATTERIE', 'CLIMATISEUR', 'CABLE'];
const ACTIVE_CATS = ['ANTENNE', 'RESEAU'];
const TARIF_CEET_FCFA = 105; // FCFA / kWh (indicatif)

const isPassiveCategorie = (cat: string) => PASSIVE_CATS.includes(cat);

/** Sources d'énergie présentes selon la configuration du site. */
function sourcesForConfig(powerConfig: string): SourceEnergie[] {
  switch (powerConfig) {
    case 'CEET_GE':
    case 'HYBRIDE_CEET_GE':
      return ['CEET', 'GE'];
    case 'CEET_UNIQUEMENT':
      return ['CEET'];
    case 'GE_UNIQUEMENT':
      return ['GE'];
    case 'HYBRIDE_GE':
      return ['GE', 'SOLAIRE'];
    case 'SOLAIRE_UNIQUEMENT':
      return ['SOLAIRE'];
    default:
      return [];
  }
}

/**
 * Détermine le prestataire responsable d'une maintenance à partir du lot du site
 * et du périmètre (passive/active déduit de la catégorie). Renvoie null si non attribué.
 */
async function resolvePrestataireId(siteId: string, categorie: string): Promise<string | null> {
  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { lotId: true } });
  if (!site?.lotId) return null;

  const scope = PASSIVE_CATS.includes(categorie)
    ? 'PASSIVE'
    : ACTIVE_CATS.includes(categorie)
      ? 'ACTIVE'
      : null;
  // Périmètre spécifique d'abord, puis "les deux"
  const scopes: ScopeMaintenance[] = scope
    ? [scope as ScopeMaintenance, 'LES_DEUX']
    : ['LES_DEUX'];

  const assignment = await prisma.lotAssignment.findFirst({
    where: { lotId: site.lotId, scope: { in: scopes } },
    orderBy: { scope: 'asc' },
  });
  return assignment?.prestataireId ?? null;
}

export async function getMaintenances(req: Request, res: Response, next: NextFunction) {
  try {
    const { type, statut, site_id, technicien_id, prestataire_id, categorie, date_debut, date_fin, page = '1', limit = '20' } =
      req.query as Record<string, string>;

    const where: Record<string, unknown> = {};
    if (type) where.type = type;
    if (statut) where.statut = statut;
    if (categorie) where.categorie = categorie;
    if (site_id) where.siteId = site_id;
    if (technicien_id) where.technicienId = technicien_id;
    if (prestataire_id) where.prestataireId = prestataire_id;
    if (date_debut || date_fin) {
      where.datePlanifiee = {
        ...(date_debut ? { gte: parseISO(date_debut) } : {}),
        ...(date_fin ? { lte: parseISO(date_fin) } : {}),
      };
    }

    const { data, meta } = await paginate(
      prisma.maintenance,
      {
        where,
        orderBy: { datePlanifiee: 'desc' },
        include: {
          ...techInclude,
          site: { select: { nom: true, code: true, region: true } },
          prestataire: { select: { id: true, nom: true } },
        },
      },
      { page: parseInt(page), limit: parseInt(limit) }
    );

    res.json({ success: true, data, meta });
  } catch (err) { next(err); }
}

export async function getMaintenanceById(req: Request, res: Response, next: NextFunction) {
  try {
    const maintenance = await prisma.maintenance.findUnique({
      where: { id: req.params.id },
      include: {
        site: true,
        technicien: { select: { id: true, nom: true, prenom: true, telephone: true } },
        prestataire: { select: { id: true, nom: true, telephone: true } },
        pieces: true,
        photos: true,
        releves: true,
        incident: { select: { id: true, type: true, severite: true } },
      },
    });
    if (!maintenance) throw new AppError('Maintenance introuvable', 404);
    res.json({ success: true, data: maintenance });
  } catch (err) { next(err); }
}

export async function createMaintenance(req: Request, res: Response, next: NextFunction) {
  try {
    const { pieces, ...data } = req.body;
    // Détermine automatiquement le prestataire responsable (site → lot → attribution).
    const prestataireId = await resolvePrestataireId(data.siteId, data.categorie);
    const maintenance = await prisma.maintenance.create({
      data: {
        ...data,
        datePlanifiee: new Date(data.datePlanifiee),
        technicienId: data.technicienId ?? req.user!.id,
        prestataireId,
        ...(pieces?.length ? { pieces: { create: pieces } } : {}),
      },
      include: { pieces: true, prestataire: { select: { id: true, nom: true } } },
    });
    await auditLog(req.user!.id, 'CREATE', 'maintenances', maintenance.id, data, req);
    res.status(201).json({ success: true, data: maintenance });
  } catch (err) { next(err); }
}

export async function updateMaintenance(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.maintenance.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Maintenance introuvable', 404);

    const { pieces: _pieces, site: _site, technicien: _tech, ...data } = req.body;
    if (data.datePlanifiee) data.datePlanifiee = new Date(data.datePlanifiee);

    const updated = await prisma.maintenance.update({ where: { id: req.params.id }, data });
    await auditLog(req.user!.id, 'UPDATE', 'maintenances', existing.id, data, req);
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

export async function deleteMaintenance(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.maintenance.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Maintenance introuvable', 404);
    await prisma.maintenance.delete({ where: { id: req.params.id } });
    await auditLog(req.user!.id, 'DELETE', 'maintenances', existing.id, {}, req);
    res.json({ success: true, message: 'Maintenance supprimée' });
  } catch (err) { next(err); }
}

/** Démarre une maintenance (passage EN_COURS + horodatage). */
export async function startMaintenance(req: Request, res: Response, next: NextFunction) {
  try {
    const { latitude, longitude } = req.body;
    const existing = await prisma.maintenance.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Maintenance introuvable', 404);
    if (existing.statut === 'TERMINEE') throw new AppError('Maintenance déjà terminée', 409);

    const updated = await prisma.maintenance.update({
      where: { id: req.params.id },
      data: {
        statut: 'EN_COURS',
        dateDebut: new Date(),
        technicienId: existing.technicienId ?? req.user!.id,
        latitudeDebut: latitude ?? undefined,
        longitudeDebut: longitude ?? undefined,
      },
    });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

/** Clôture une maintenance : durée calculée, pièces ajoutées, relevés énergie (passive), PDF généré. */
export async function closeMaintenance(req: Request, res: Response, next: NextFunction) {
  try {
    const { observations, pieces, signaturePath, energie } = req.body as {
      observations?: string;
      pieces?: Record<string, unknown>[];
      signaturePath?: string;
      energie?: Record<string, unknown>;
    };
    const existing = await prisma.maintenance.findUnique({
      where: { id: req.params.id },
      include: { site: { select: { id: true, powerConfig: true } } },
    });
    if (!existing) throw new AppError('Maintenance introuvable', 404);

    // Maintenance passive → relevés énergie obligatoires selon la config du site.
    const passive = isPassiveCategorie(existing.categorie);
    const sources = passive ? sourcesForConfig(existing.site.powerConfig) : [];
    const e = energie ?? {};
    const num = (v: unknown): number | null => (v == null || v === '' ? null : Number(v));

    if (passive && sources.length) {
      const missing: string[] = [];
      if (sources.includes('GE')) {
        if (num(e.volumeGasoilLitres) == null) missing.push('volume gasoil');
        if (num(e.heuresFonctGE) == null) missing.push('heures de fonctionnement GE');
      }
      if (sources.includes('CEET') && num(e.indexCompteur) == null) missing.push('index compteur CEET');
      if (sources.includes('SOLAIRE') && num(e.puissanceKva) == null) missing.push('puissance solaire');
      if (missing.length) {
        throw new AppError(
          `Paramètres énergie requis pour clôturer cette maintenance passive : ${missing.join(', ')}.`,
          422
        );
      }
    }

    const dateFin = new Date();
    const dateDebut = existing.dateDebut ?? dateFin;
    const dureeMinutes = Math.max(0, differenceInMinutes(dateFin, dateDebut));

    if (pieces?.length) {
      await prisma.pieceRechange.createMany({
        data: pieces.map((p) => ({ ...p, maintenanceId: existing.id })) as unknown as Prisma.PieceRechangeCreateManyInput[],
      });
    }

    let updated = await prisma.maintenance.update({
      where: { id: req.params.id },
      data: { statut: 'TERMINEE', dateFin, dureeMinutes, observations, signaturePath },
    });

    // Création des relevés énergie liés à la maintenance (un par source présente)
    if (passive && sources.length) {
      for (const source of sources) {
        const data: Prisma.ReleveEnergieUncheckedCreateInput = {
          siteId: existing.siteId,
          dateReleve: dateFin,
          source,
          technicienId: existing.technicienId ?? req.user!.id,
          maintenanceId: existing.id,
        };
        if (source === 'GE') {
          const vol = num(e.volumeGasoilLitres);
          data.volumeGasoilLitres = vol;
          data.heuresFonctGE = num(e.heuresFonctGE);
          data.coutEstime = vol != null ? Math.round(vol * GE_PARAMS.prixLitreFCFA) : null;
        } else if (source === 'CEET') {
          const kwh = num(e.consommationKwh);
          data.indexCompteur = num(e.indexCompteur);
          data.consommationKwh = kwh;
          data.coutEstime = kwh != null ? Math.round(kwh * TARIF_CEET_FCFA) : null;
        } else if (source === 'SOLAIRE') {
          data.puissanceKva = num(e.puissanceKva);
        }
        await prisma.releveEnergie.create({ data });
      }
    }

    // Génération + stockage du rapport PDF
    const full = await prisma.maintenance.findUnique({
      where: { id: req.params.id },
      include: { site: true, technicien: { select: { nom: true, prenom: true } }, pieces: true },
    });
    if (full) {
      const pdf = await generateMaintenancePdf(full);
      const stored = await uploadBuffer(pdf, `maintenance-${full.id}.pdf`, 'application/pdf', 'rapports');
      updated = await prisma.maintenance.update({
        where: { id: req.params.id },
        data: { rapportPdfPath: stored.key },
      });
    }

    await auditLog(req.user!.id, 'CLOSE', 'maintenances', existing.id, { dureeMinutes }, req);
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

/** Retourne (ou génère à la volée) le PDF d'une maintenance. */
export async function getMaintenancePdf(req: Request, res: Response, next: NextFunction) {
  try {
    const maintenance = await prisma.maintenance.findUnique({
      where: { id: req.params.id },
      include: { site: true, technicien: { select: { nom: true, prenom: true } }, pieces: true },
    });
    if (!maintenance) throw new AppError('Maintenance introuvable', 404);

    const pdf = await generateMaintenancePdf(maintenance);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="maintenance-${maintenance.id.slice(0, 8)}.pdf"`);
    res.send(pdf);
  } catch (err) { next(err); }
}

/** Planning hebdomadaire des maintenances (calendrier). */
export async function getPlanning(req: Request, res: Response, next: NextFunction) {
  try {
    const { semaine, region } = req.query as Record<string, string>;
    const ref = semaine ? parseISO(semaine) : new Date();
    const debut = startOfWeek(ref, { weekStartsOn: 1 });
    const fin = endOfWeek(ref, { weekStartsOn: 1 });

    const maintenances = await prisma.maintenance.findMany({
      where: {
        datePlanifiee: { gte: debut, lte: fin },
        ...(region ? { site: { region } } : {}),
      },
      orderBy: { datePlanifiee: 'asc' },
      include: {
        site: { select: { nom: true, code: true, region: true } },
        technicien: { select: { nom: true, prenom: true } },
      },
    });

    res.json({ success: true, data: { debut, fin, maintenances } });
  } catch (err) { next(err); }
}

export async function exportMaintenances(req: Request, res: Response, next: NextFunction) {
  try {
    const { type, statut, site_id } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (type) where.type = type;
    if (statut) where.statut = statut;
    if (site_id) where.siteId = site_id;

    const rows = await prisma.maintenance.findMany({
      where,
      orderBy: { datePlanifiee: 'desc' },
      include: { site: { select: { code: true, nom: true } }, technicien: { select: { nom: true, prenom: true } } },
    });

    const buffer = await buildXlsx(
      'Maintenances',
      [
        { header: 'Site', key: 'site', width: 18 },
        { header: 'Type', key: 'type', width: 12 },
        { header: 'Catégorie', key: 'categorie', width: 14 },
        { header: 'Équipement', key: 'equipement', width: 22 },
        { header: 'Statut', key: 'statut', width: 12 },
        { header: 'Technicien', key: 'technicien', width: 20 },
        { header: 'Planifiée', key: 'datePlanifiee', width: 18 },
        { header: 'Durée (min)', key: 'duree', width: 12 },
      ],
      rows.map((m) => ({
        site: m.site?.code ?? '',
        type: m.type,
        categorie: m.categorie,
        equipement: m.equipement,
        statut: m.statut,
        technicien: m.technicien ? `${m.technicien.prenom} ${m.technicien.nom}` : '',
        datePlanifiee: m.datePlanifiee.toLocaleString('fr-FR'),
        duree: m.dureeMinutes ?? '',
      }))
    );

    await auditLog(req.user!.id, 'EXPORT', 'maintenances', undefined, { count: rows.length }, req);
    setXlsxHeaders(res, 'maintenances.xlsx');
    res.send(buffer);
  } catch (err) { next(err); }
}
