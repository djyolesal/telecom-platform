import { Request, Response, NextFunction } from 'express';
import { startOfMonth, endOfMonth, subMonths, format } from 'date-fns';
import { prisma } from '../config/database';
import { auditLog } from '../services/audit.service';
import { calculerStockSite } from '../utils/calculator';
import { generateMonthlyReportPdf, MonthlyReportData } from '../services/pdf.service';
import { sendEmail } from '../services/email.service';
import { AppError } from '../utils/AppError';

/** Dernier relevé GE (volume gasoil) par site. */
async function dernierStockParSite(): Promise<Map<string, number>> {
  const releves = await prisma.releveEnergie.findMany({
    where: { source: 'GE', volumeGasoilLitres: { not: null } },
    orderBy: { dateReleve: 'desc' },
    select: { siteId: true, volumeGasoilLitres: true, dateReleve: true },
  });
  const map = new Map<string, number>();
  for (const r of releves) {
    if (!map.has(r.siteId)) map.set(r.siteId, Number(r.volumeGasoilLitres));
  }
  return map;
}

// ── Dashboard principal ──────────────────────────────────────
export async function getDashboard(req: Request, res: Response, next: NextFunction) {
  try {
    const { region } = req.query as Record<string, string>;
    const siteWhere: Record<string, unknown> = { isActive: true, ...(region ? { region } : {}) };

    const [sites, incidentsOuverts, incidentsCritiques, stockMap] = await Promise.all([
      prisma.site.findMany({ where: siteWhere }),
      prisma.incident.count({ where: { statut: { in: ['OUVERT', 'EN_COURS'] }, ...(region ? { site: { region } } : {}) } }),
      prisma.incident.count({ where: { statut: { in: ['OUVERT', 'EN_COURS'] }, severite: 'CRITIQUE', ...(region ? { site: { region } } : {}) } }),
      dernierStockParSite(),
    ]);

    // Stock & autonomie par site
    const stocks = sites.map((site) => {
      const volume = stockMap.get(site.id) ?? 0;
      return { site, stock: calculerStockSite(site, { volumeGasoilLitres: volume }) };
    });

    const stockTotalLitres = stocks.reduce((s, x) => s + x.stock.stockLitres, 0);
    const sitesCritiques = stocks.filter((x) => ['CRITIQUE', 'VIDE'].includes(x.stock.niveauAlerte)).length;
    const autonomies = stocks.map((x) => x.stock.autonomieJours).filter((a): a is number => a != null).sort((a, b) => a - b);
    const autonomieMediane = autonomies.length ? autonomies[Math.floor(autonomies.length / 2)] : null;

    // Répartition power config
    const parPowerConfig: Record<string, number> = {};
    sites.forEach((s) => { parPowerConfig[s.powerConfig] = (parPowerConfig[s.powerConfig] || 0) + 1; });

    // Stock par région
    const parRegion: Record<string, number> = {};
    stocks.forEach((x) => { parRegion[x.site.region] = (parRegion[x.site.region] || 0) + x.stock.stockLitres; });
    const stockParRegion = Object.entries(parRegion).map(([reg, stock]) => ({ region: reg, stock })).sort((a, b) => b.stock - a.stock);

    // Conso mensuelle 6 mois (GE vs CEET)
    const sixMoisAgo = startOfMonth(subMonths(new Date(), 5));
    const releves = await prisma.releveEnergie.findMany({
      where: { dateReleve: { gte: sixMoisAgo }, ...(region ? { site: { region } } : {}) },
      select: { dateReleve: true, source: true, consommationKwh: true },
    });
    const consoMap = new Map<string, { ge: number; ceet: number }>();
    for (let i = 5; i >= 0; i--) {
      const key = format(subMonths(new Date(), i), 'MMM yy');
      consoMap.set(key, { ge: 0, ceet: 0 });
    }
    releves.forEach((r) => {
      const key = format(r.dateReleve, 'MMM yy');
      const bucket = consoMap.get(key);
      if (bucket && r.consommationKwh != null) {
        if (r.source === 'GE') bucket.ge += Number(r.consommationKwh);
        else if (r.source === 'CEET') bucket.ceet += Number(r.consommationKwh);
      }
    });
    const consoMensuelle = Array.from(consoMap.entries()).map(([mois, v]) => ({ mois, ge: Math.round(v.ge), ceet: Math.round(v.ceet) }));

    // Incidents récents
    const incidentsRecents = await prisma.incident.findMany({
      where: region ? { site: { region } } : {},
      orderBy: { dateOuverture: 'desc' },
      take: 8,
      include: { site: { select: { code: true, nom: true } } },
    });

    res.json({
      success: true,
      data: {
        sitesActifs: sites.length,
        incidentsOuverts,
        incidentsCritiques,
        sitesCritiques,
        stockTotalLitres,
        autonomieMediane,
        parPowerConfig,
        stockParRegion,
        consoMensuelle,
        incidentsRecents: incidentsRecents.map((i) => ({
          id: i.id, siteCode: i.site?.code, siteNom: i.site?.nom, type: i.type, severite: i.severite, statut: i.statut,
        })),
      },
    });
  } catch (err) { next(err); }
}

// ── Stock carburant détaillé ─────────────────────────────────
export async function getStockCarburant(req: Request, res: Response, next: NextFunction) {
  try {
    const { region } = req.query as Record<string, string>;
    const sites = await prisma.site.findMany({
      where: { isActive: true, ...(region ? { region } : {}) },
      orderBy: { code: 'asc' },
    });
    const stockMap = await dernierStockParSite();

    const data = sites.map((site) => {
      const stock = calculerStockSite(site, { volumeGasoilLitres: stockMap.get(site.id) ?? 0 });
      return { siteId: site.id, code: site.code, nom: site.nom, region: site.region, statutGE: site.statutGE, ...stock };
    });

    const resume = {
      totalLitres: data.reduce((s, x) => s + x.stockLitres, 0),
      totalLitresMois: data.reduce((s, x) => s + x.litresMois, 0),
      totalCoutMoisFCFA: data.reduce((s, x) => s + x.coutMoisFCFA, 0),
      nbSitesVides: data.filter((x) => x.niveauAlerte === 'VIDE').length,
      nbSitesCritiques: data.filter((x) => x.niveauAlerte === 'CRITIQUE').length,
      nbSitesFaibles: data.filter((x) => x.niveauAlerte === 'FAIBLE').length,
    };

    res.json({ success: true, data: { resume, sites: data } });
  } catch (err) { next(err); }
}

// ── Consommation énergie ─────────────────────────────────────
export async function getConsoEnergie(req: Request, res: Response, next: NextFunction) {
  try {
    const { site_id, periode = '180' } = req.query as Record<string, string>;
    const since = new Date(Date.now() - parseInt(periode) * 24 * 60 * 60 * 1000);

    const releves = await prisma.releveEnergie.findMany({
      where: { dateReleve: { gte: since }, ...(site_id ? { siteId: site_id } : {}) },
      orderBy: { dateReleve: 'asc' },
      include: { site: { select: { code: true } } },
    });

    const totalKwh = releves.reduce((s, r) => s + Number(r.consommationKwh ?? 0), 0);
    const totalGasoil = releves.reduce((s, r) => s + Number(r.volumeGasoilLitres ?? 0), 0);
    const totalHeuresGE = releves.reduce((s, r) => s + Number(r.heuresFonctGE ?? 0), 0);
    const coutTotal = releves.reduce((s, r) => s + Number(r.coutEstime ?? 0), 0);

    res.json({
      success: true,
      data: {
        periodeJours: parseInt(periode),
        totaux: { consoKwh: Math.round(totalKwh), gasoilLitres: Math.round(totalGasoil), heuresGE: Math.round(totalHeuresGE), coutFCFA: coutTotal },
        nbReleves: releves.length,
        releves: releves.map((r) => ({
          date: r.dateReleve, site: r.site?.code, source: r.source,
          consommationKwh: r.consommationKwh != null ? Number(r.consommationKwh) : null,
          volumeGasoilLitres: r.volumeGasoilLitres != null ? Number(r.volumeGasoilLitres) : null,
        })),
      },
    });
  } catch (err) { next(err); }
}

// ── Rapport maintenance ──────────────────────────────────────
export async function getRapportMaintenance(req: Request, res: Response, next: NextFunction) {
  try {
    const { periode = '30', region } = req.query as Record<string, string>;
    const since = new Date(Date.now() - parseInt(periode) * 24 * 60 * 60 * 1000);
    const where = { datePlanifiee: { gte: since }, ...(region ? { site: { region } } : {}) };

    const maintenances = await prisma.maintenance.findMany({ where, select: { type: true, statut: true, categorie: true, dureeMinutes: true } });

    const parStatut: Record<string, number> = {};
    const parCategorie: Record<string, number> = {};
    maintenances.forEach((m) => {
      parStatut[m.statut] = (parStatut[m.statut] || 0) + 1;
      parCategorie[m.categorie] = (parCategorie[m.categorie] || 0) + 1;
    });
    const terminees = maintenances.filter((m) => m.statut === 'TERMINEE');
    const dureeMoyenne = terminees.length
      ? Math.round(terminees.reduce((s, m) => s + (m.dureeMinutes || 0), 0) / terminees.length) : 0;

    res.json({
      success: true,
      data: {
        total: maintenances.length,
        preventives: maintenances.filter((m) => m.type === 'PREVENTIVE').length,
        curatives: maintenances.filter((m) => m.type === 'CURATIVE').length,
        terminees: terminees.length,
        dureeMoyenneMinutes: dureeMoyenne,
        parStatut, parCategorie,
      },
    });
  } catch (err) { next(err); }
}

// ── Rapport incidents (réutilise la logique KPI) ─────────────
export async function getRapportIncidents(req: Request, res: Response, next: NextFunction) {
  try {
    const { periode = '30', region } = req.query as Record<string, string>;
    const since = new Date(Date.now() - parseInt(periode) * 24 * 60 * 60 * 1000);
    const incidents = await prisma.incident.findMany({
      where: { dateOuverture: { gte: since }, ...(region ? { site: { region } } : {}) },
      select: { type: true, severite: true, statut: true, dureeCoupureMinutes: true, delaiInterventionMinutes: true },
    });

    const resolus = incidents.filter((i) => ['RESOLU', 'CLOS'].includes(i.statut));
    const mttr = resolus.length ? Math.round(resolus.reduce((s, i) => s + (i.dureeCoupureMinutes || 0), 0) / resolus.length) : 0;
    const mtti = resolus.length ? Math.round(resolus.reduce((s, i) => s + (i.delaiInterventionMinutes || 0), 0) / resolus.length) : 0;

    res.json({ success: true, data: { total: incidents.length, resolus: resolus.length, mttrMinutes: mttr, mttiMinutes: mtti } });
  } catch (err) { next(err); }
}

// ── Génération du rapport mensuel (données agrégées) ─────────
export async function buildMonthlyData(annee: number, mois: number, region?: string): Promise<MonthlyReportData> {
  const debut = startOfMonth(new Date(annee, mois - 1, 1));
  const fin = endOfMonth(debut);
  const siteRegion = region ? { site: { region } } : {};

  const [sitesActifs, incidents, maintenances, depotages, releves] = await Promise.all([
    prisma.site.count({ where: { isActive: true, ...(region ? { region } : {}) } }),
    prisma.incident.findMany({ where: { dateOuverture: { gte: debut, lte: fin }, ...siteRegion }, select: { statut: true, dureeCoupureMinutes: true, delaiInterventionMinutes: true } }),
    prisma.maintenance.findMany({ where: { datePlanifiee: { gte: debut, lte: fin }, ...siteRegion }, select: { type: true } }),
    prisma.depotage.findMany({ where: { dateDepotage: { gte: debut, lte: fin }, ...siteRegion }, select: { volumeLitres: true, coutTotal: true } }),
    prisma.releveEnergie.findMany({ where: { dateReleve: { gte: debut, lte: fin }, ...siteRegion }, select: { consommationKwh: true, coutEstime: true } }),
  ]);

  const resolus = incidents.filter((i) => ['RESOLU', 'CLOS'].includes(i.statut));

  return {
    annee, mois, region,
    sitesActifs,
    incidents: {
      total: incidents.length,
      resolus: resolus.length,
      mttrMinutes: resolus.length ? Math.round(resolus.reduce((s, i) => s + (i.dureeCoupureMinutes || 0), 0) / resolus.length) : 0,
      mttiMinutes: resolus.length ? Math.round(resolus.reduce((s, i) => s + (i.delaiInterventionMinutes || 0), 0) / resolus.length) : 0,
    },
    maintenances: {
      total: maintenances.length,
      preventives: maintenances.filter((m) => m.type === 'PREVENTIVE').length,
      curatives: maintenances.filter((m) => m.type === 'CURATIVE').length,
    },
    carburant: {
      nbDepotages: depotages.length,
      volumeDepoteLitres: Math.round(depotages.reduce((s, d) => s + Number(d.volumeLitres), 0)),
      coutTotalFCFA: depotages.reduce((s, d) => s + Number(d.coutTotal ?? 0), 0),
    },
    energie: {
      consoTotaleKwh: Math.round(releves.reduce((s, r) => s + Number(r.consommationKwh ?? 0), 0)),
      coutEstimeFCFA: releves.reduce((s, r) => s + Number(r.coutEstime ?? 0), 0),
    },
  };
}

export async function getRapportMensuelPdf(req: Request, res: Response, next: NextFunction) {
  try {
    const annee = parseInt(req.params.annee);
    const mois = parseInt(req.params.mois);
    if (!annee || mois < 1 || mois > 12) throw new AppError('Année/mois invalides', 400);

    const data = await buildMonthlyData(annee, mois, req.query.region as string | undefined);
    const pdf = await generateMonthlyReportPdf(data);

    await auditLog(req.user!.id, 'EXPORT', 'rapport_mensuel', undefined, { annee, mois }, req);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="rapport-${annee}-${String(mois).padStart(2, '0')}.pdf"`);
    res.send(pdf);
  } catch (err) { next(err); }
}

export async function sendRapportMensuel(req: Request, res: Response, next: NextFunction) {
  try {
    const { destinataires, annee, mois, region } = req.body as {
      destinataires: string[]; annee: number; mois: number; region?: string;
    };
    if (!destinataires?.length) throw new AppError('Liste de destinataires requise', 400);

    const now = new Date();
    const an = annee || now.getFullYear();
    const mo = mois || now.getMonth() + 1;
    const data = await buildMonthlyData(an, mo, region);
    const pdf = await generateMonthlyReportPdf(data);

    const sent = await sendEmail({
      to: destinataires,
      subject: `Rapport mensuel TélécomOps — ${String(mo).padStart(2, '0')}/${an}`,
      html: `<p>Bonjour,</p><p>Veuillez trouver ci-joint le rapport mensuel d'exploitation (${String(mo).padStart(2, '0')}/${an}).</p>`,
      attachments: [{ filename: `rapport-${an}-${String(mo).padStart(2, '0')}.pdf`, content: pdf, contentType: 'application/pdf' }],
    });

    await auditLog(req.user!.id, 'EXPORT', 'rapport_mensuel', undefined, { annee: an, mois: mo, destinataires, sent }, req);
    res.json({ success: true, message: sent ? 'Rapport envoyé' : 'SMTP non configuré — rapport non envoyé', data: { sent } });
  } catch (err) { next(err); }
}

// ── Conformité des maintenances passives ─────────────────────
// Maintenances passives clôturées AVEC vs SANS relevés énergie, par prestataire.
const PASSIVE_CATS = ['GE', 'BATTERIE', 'CLIMATISEUR', 'CABLE'];

export async function getConformiteMaintenance(req: Request, res: Response, next: NextFunction) {
  try {
    const { periode = '90', prestataire_id, region } = req.query as Record<string, string>;
    const since = new Date(Date.now() - parseInt(periode) * 24 * 60 * 60 * 1000);

    const maints = await prisma.maintenance.findMany({
      where: {
        statut: 'TERMINEE',
        categorie: { in: PASSIVE_CATS as never[] },
        dateFin: { gte: since },
        ...(prestataire_id ? { prestataireId: prestataire_id } : {}),
        ...(region ? { site: { region } } : {}),
      },
      select: {
        prestataireId: true,
        prestataire: { select: { nom: true } },
        _count: { select: { releves: true } },
      },
    });

    const map = new Map<string, { prestataireId: string; prestataireNom: string; total: number; conformes: number }>();
    for (const m of maints) {
      const key = m.prestataireId ?? 'NON_ATTRIBUE';
      if (!map.has(key)) {
        map.set(key, { prestataireId: key, prestataireNom: m.prestataire?.nom ?? 'Non attribué', total: 0, conformes: 0 });
      }
      const e = map.get(key)!;
      e.total++;
      if (m._count.releves > 0) e.conformes++;
    }

    const parPrestataire = Array.from(map.values())
      .map((e) => ({
        ...e,
        nonConformes: e.total - e.conformes,
        tauxConformite: e.total ? Math.round((e.conformes / e.total) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total);

    const conformes = parPrestataire.reduce((s, x) => s + x.conformes, 0);
    res.json({
      success: true,
      data: {
        periodeJours: parseInt(periode),
        totaux: {
          total: maints.length,
          conformes,
          nonConformes: maints.length - conformes,
          tauxConformite: maints.length ? Math.round((conformes / maints.length) * 100) : 0,
        },
        parPrestataire,
      },
    });
  } catch (err) { next(err); }
}
