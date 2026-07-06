import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { paginate } from '../utils/paginator';
import { auditLog } from '../services/audit.service';
import { notificationService } from '../services/notifications.service';
import { sendTabular } from '../utils/exporter';
import { io } from '../server';
import { differenceInMinutes } from 'date-fns';

export async function getIncidents(req: Request, res: Response, next: NextFunction) {
  try {
    const { type, severite, statut, site_id, technicien_id, region, page = '1', limit = '20' } = req.query as Record<string, string>;

    const where: Record<string, unknown> = {};
    if (type) where.type = type;
    if (severite) where.severite = severite;
    if (statut) where.statut = statut;
    if (site_id) where.siteId = site_id;
    if (technicien_id) where.technicienId = technicien_id;
    if (region) where.site = { region };

    const { data, meta } = await paginate(
      prisma.incident,
      {
        where,
        orderBy: [{ severite: 'asc' }, { dateOuverture: 'desc' }],
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

export async function getIncidentById(req: Request, res: Response, next: NextFunction) {
  try {
    const incident = await prisma.incident.findUnique({
      where: { id: req.params.id },
      include: {
        site: true,
        technicien: { select: { id: true, nom: true, prenom: true, telephone: true } },
        declarant: { select: { id: true, nom: true, prenom: true } },
        maintenances: { select: { id: true, type: true, statut: true, datePlanifiee: true } },
      },
    });
    if (!incident) throw new AppError('Incident introuvable', 404);
    res.json({ success: true, data: incident });
  } catch (err) { next(err); }
}

export async function createIncident(req: Request, res: Response, next: NextFunction) {
  try {
    const incident = await prisma.incident.create({
      data: { ...req.body, declarePar: req.user!.id },
      include: { site: { select: { nom: true, code: true, region: true } } },
    });

    await auditLog(req.user!.id, 'CREATE', 'incidents', incident.id, req.body, req);

    // Notifier via WebSocket
    io.of('/supervision').emit('incident:created', {
      id: incident.id,
      type: incident.type,
      severite: incident.severite,
      site: incident.site,
      dateOuverture: incident.dateOuverture,
    });

    // Push notifications si critique
    if (incident.severite === 'CRITIQUE' || incident.severite === 'MAJEUR') {
      await notificationService.sendToRole('SUPERVISEUR', {
        title: `🔴 Incident ${incident.severite} — ${incident.site.code}`,
        body: incident.description.substring(0, 100),
        data: { incidentId: incident.id, type: 'incident' },
      });
    }

    res.status(201).json({ success: true, data: incident });
  } catch (err) { next(err); }
}

export async function updateIncident(req: Request, res: Response, next: NextFunction) {
  try {
    const incident = await prisma.incident.findUnique({ where: { id: req.params.id } });
    if (!incident) throw new AppError('Incident introuvable', 404);

    const updated = await prisma.incident.update({ where: { id: req.params.id }, data: req.body });
    await auditLog(req.user!.id, 'UPDATE', 'incidents', incident.id, { before: incident, after: req.body }, req);

    io.of('/supervision').emit('incident:updated', { id: updated.id, statut: updated.statut });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

export async function assignIncident(req: Request, res: Response, next: NextFunction) {
  try {
    const { technicienId } = req.body;
    const incident = await prisma.incident.update({
      where: { id: req.params.id },
      data: { technicienId, statut: 'EN_COURS' },
      include: { site: { select: { nom: true, code: true } } },
    });

    await auditLog(req.user!.id, 'ASSIGN', 'incidents', incident.id, { technicienId }, req);

    // Notifier le technicien
    await notificationService.sendToUser(technicienId, {
      title: `📋 Incident assigné — ${incident.site.code}`,
      body: `Vous êtes assigné à l'incident : ${incident.description.substring(0, 80)}`,
      data: { incidentId: incident.id, type: 'incident_assigned' },
    });

    res.json({ success: true, data: incident });
  } catch (err) { next(err); }
}

export async function closeIncident(req: Request, res: Response, next: NextFunction) {
  try {
    const { dateIntervention, dateResolution, causeProbable, actionCorrective, creerMaintenance } = req.body;
    const incident = await prisma.incident.findUnique({ where: { id: req.params.id } });
    if (!incident) throw new AppError('Incident introuvable', 404);

    const dateInterv = new Date(dateIntervention);
    const dateResol = new Date(dateResolution);
    const delai = differenceInMinutes(dateInterv, incident.dateOuverture);
    const duree = differenceInMinutes(dateResol, incident.dateOuverture);

    const updated = await prisma.incident.update({
      where: { id: req.params.id },
      data: {
        statut: 'RESOLU',
        dateIntervention: dateInterv,
        dateResolution: dateResol,
        delaiInterventionMinutes: delai > 0 ? delai : 0,
        dureeCoupureMinutes: duree > 0 ? duree : 0,
        causeProbable,
        actionCorrective,
      },
    });

    // Créer maintenance curative si demandé
    if (creerMaintenance) {
      await prisma.maintenance.create({
        data: {
          siteId: incident.siteId,
          incidentId: incident.id,
          type: 'CURATIVE',
          categorie: 'AUTRE',
          equipement: 'À préciser',
          description: `Maintenance suite incident : ${incident.description}`,
          statut: 'TERMINEE',
          datePlanifiee: dateResol,
          dateDebut: dateInterv,
          dateFin: dateResol,
          technicienId: incident.technicienId,
        },
      });
    }

    await auditLog(req.user!.id, 'CLOSE', 'incidents', incident.id, { causeProbable, duree }, req);
    io.of('/supervision').emit('incident:resolved', { id: updated.id, dureeCoupureMinutes: duree });

    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

export async function deleteIncident(req: Request, res: Response, next: NextFunction) {
  try {
    const incident = await prisma.incident.findUnique({ where: { id: req.params.id } });
    if (!incident) throw new AppError('Incident introuvable', 404);
    // Détacher les maintenances liées avant suppression
    await prisma.maintenance.updateMany({ where: { incidentId: incident.id }, data: { incidentId: null } });
    await prisma.incident.delete({ where: { id: req.params.id } });
    await auditLog(req.user!.id, 'DELETE', 'incidents', incident.id, {}, req);
    res.json({ success: true, message: 'Incident supprimé' });
  } catch (err) { next(err); }
}

export async function exportIncidents(req: Request, res: Response, next: NextFunction) {
  try {
    const { type, severite, statut, site_id, region } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (type) where.type = type;
    if (severite) where.severite = severite;
    if (statut) where.statut = statut;
    if (site_id) where.siteId = site_id;
    if (region) where.site = { region };

    const rows = await prisma.incident.findMany({
      where,
      orderBy: { dateOuverture: 'desc' },
      include: { site: { select: { code: true, region: true } }, technicien: { select: { nom: true, prenom: true } } },
    });

    await auditLog(req.user!.id, 'EXPORT', 'incidents', undefined, { count: rows.length }, req);
    await sendTabular(res, req.params.format, 'incidents', 'Incidents', [{
      name: 'Incidents',
      columns: [
        { header: 'Site', key: 'site', width: 14 },
        { header: 'Région', key: 'region', width: 14 },
        { header: 'Type', key: 'type', width: 16 },
        { header: 'Sévérité', key: 'severite', width: 12 },
        { header: 'Statut', key: 'statut', width: 12 },
        { header: 'Ouverture', key: 'ouverture', width: 18 },
        { header: 'Résolution', key: 'resolution', width: 18 },
        { header: 'MTTI (min)', key: 'mtti', width: 12 },
        { header: 'Coupure (min)', key: 'coupure', width: 14 },
        { header: 'Technicien', key: 'technicien', width: 20 },
      ],
      rows: rows.map((i) => ({
        site: i.site?.code ?? '',
        region: i.site?.region ?? '',
        type: i.type,
        severite: i.severite,
        statut: i.statut,
        ouverture: i.dateOuverture.toLocaleString('fr-FR'),
        resolution: i.dateResolution ? i.dateResolution.toLocaleString('fr-FR') : '',
        mtti: i.delaiInterventionMinutes ?? '',
        coupure: i.dureeCoupureMinutes ?? '',
        technicien: i.technicien ? `${i.technicien.prenom} ${i.technicien.nom}` : '',
      })),
    }]);
  } catch (err) { next(err); }
}

export async function getIncidentKPIs(req: Request, res: Response, next: NextFunction) {
  try {
    const { periode = '30', region } = req.query as Record<string, string>;
    const days = parseInt(periode);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const siteFilter = region ? { site: { region } } : {};

    // Incidents de la période
    const incidents = await prisma.incident.findMany({
      where: { dateOuverture: { gte: since }, ...siteFilter },
      include: { site: { select: { region: true, code: true, nom: true } } },
    });

    const resolus = incidents.filter(i => i.statut === 'RESOLU' || i.statut === 'CLOS');
    const avecDelai = resolus.filter(i => i.delaiInterventionMinutes !== null);
    const avecDuree = resolus.filter(i => i.dureeCoupureMinutes !== null);

    const mttr = avecDuree.length
      ? Math.round(avecDuree.reduce((s, i) => s + (i.dureeCoupureMinutes || 0), 0) / avecDuree.length)
      : 0;
    const mtti = avecDelai.length
      ? Math.round(avecDelai.reduce((s, i) => s + (i.delaiInterventionMinutes || 0), 0) / avecDelai.length)
      : 0;

    // Taux résolution J+1 (1440 min), J+3, J+7
    const j1 = resolus.filter(i => (i.dureeCoupureMinutes || 0) <= 1440).length;
    const j3 = resolus.filter(i => (i.dureeCoupureMinutes || 0) <= 4320).length;
    const j7 = resolus.filter(i => (i.dureeCoupureMinutes || 0) <= 10080).length;

    // Par type
    const parType: Record<string, number> = {};
    incidents.forEach(i => { parType[i.type] = (parType[i.type] || 0) + 1; });

    // Par sévérité
    const parSeverite: Record<string, number> = {};
    incidents.forEach(i => { parSeverite[i.severite] = (parSeverite[i.severite] || 0) + 1; });

    // Top 10 sites
    const parSite: Record<string, { count: number; code: string; nom: string }> = {};
    incidents.forEach(i => {
      if (!parSite[i.siteId]) parSite[i.siteId] = { count: 0, code: i.site.code, nom: i.site.nom };
      parSite[i.siteId].count++;
    });
    const top10 = Object.entries(parSite).sort((a, b) => b[1].count - a[1].count).slice(0, 10);

    res.json({
      success: true,
      data: {
        periode: { jours: days, debut: since, fin: new Date() },
        total: incidents.length,
        ouverts: incidents.filter(i => i.statut === 'OUVERT').length,
        enCours: incidents.filter(i => i.statut === 'EN_COURS').length,
        resolus: resolus.length,
        mttr_minutes: mttr,
        mtti_minutes: mtti,
        tauxResolutionJ1: incidents.length ? Math.round(j1 / incidents.length * 100) : 0,
        tauxResolutionJ3: incidents.length ? Math.round(j3 / incidents.length * 100) : 0,
        tauxResolutionJ7: incidents.length ? Math.round(j7 / incidents.length * 100) : 0,
        parType,
        parSeverite,
        top10Sites: top10.map(([id, { count, code, nom }]) => ({ siteId: id, code, nom, count })),
      },
    });
  } catch (err) { next(err); }
}
