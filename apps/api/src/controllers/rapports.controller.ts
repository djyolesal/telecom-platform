import { Request, Response, NextFunction } from 'express';
import { startOfMonth, endOfMonth, subMonths, format } from 'date-fns';
import { prisma } from '../config/database';
import { auditLog } from '../services/audit.service';
import { calculerStockSite } from '../utils/calculator';
import { geParams, getNum } from '../services/settings.service';
import { generateMonthlyReportPdf, MonthlyReportData } from '../services/pdf.service';
import { computeManquants } from '../services/manquants.service';
import { bilanCarburant } from '../services/bilanCarburant.service';
import { bilanEnergie } from '../services/bilanEnergie.service';
import { sendTabular } from '../utils/exporter';
import { detectFuelAnomalies } from '../services/fuelAnomaly.service';
import { geReliabilityByMarque } from '../services/geReliability.service';
import { computeSla } from '../services/slaCompliance.service';
import { computeEmpreinteCarbone, co2GasoilKg, co2ReseauKg } from '../services/carbon.service';
import { carboneFactors } from '../services/settings.service';
import { sendEmail } from '../services/email.service';
import { AppError } from '../utils/AppError';
import { sitePerimetre, isRestreint, estPrestataire } from '../utils/perimetre';
import { stockCourantParSite } from '../services/stockCourant.service';

/**
 * Stock par site — délégué à la SOURCE UNIQUE (relevé + dépotages postérieurs).
 * Cette fonction ne lisait que les relevés : un site livré après son dernier
 * relevé restait affiché « critique » ici alors que le job d'alerte et le
 * réappro le considéraient servi.
 */
const dernierStockParSite = stockCourantParSite;

// ── Dashboard principal ──────────────────────────────────────
export async function getDashboard(req: Request, res: Response, next: NextFunction) {
  try {
    const { region } = req.query as Record<string, string>;

    // Périmètre prestataire : un utilisateur rattaché à un prestataire
    // (technicien OU superviseur) ne voit le pouls QUE des sites des lots
    // attribués à sa société — même règle que la liste des sites. Les internes
    // voient tout le parc.
    const me = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { prestataireId: true } });
    const perimetre = me?.prestataireId
      ? { lot: { assignments: { some: { prestataireId: me.prestataireId } } } }
      : {};
    const siteScope: Record<string, unknown> = { ...(region ? { region } : {}), ...perimetre };
    const siteWhere: Record<string, unknown> = { isActive: true, ...siteScope };

    const [sites, incidentsOuverts, incidentsCritiques, stockMap] = await Promise.all([
      prisma.site.findMany({ where: siteWhere }),
      prisma.incident.count({ where: { statut: { in: ['OUVERT', 'EN_COURS'] }, site: siteScope } }),
      prisma.incident.count({ where: { statut: { in: ['OUVERT', 'EN_COURS'] }, severite: 'CRITIQUE', site: siteScope } }),
      dernierStockParSite(),
    ]);

    // Stock & autonomie par site
    const stocks = sites.map((site) => {
      const volume = stockMap.get(site.id) ?? 0;
      return { site, stock: calculerStockSite(site, { volumeGasoilLitres: volume }, geParams()) };
    });

    const stockTotalLitres = stocks.reduce((s, x) => s + x.stock.stockLitres, 0);
    const sitesCritiques = stocks.filter((x) => ['CRITIQUE', 'VIDE'].includes(x.stock.niveauAlerte)).length;
    const sitesFaibles = stocks.filter((x) => x.stock.niveauAlerte === 'FAIBLE').length;
    const sitesOk = stocks.filter((x) => x.stock.niveauAlerte === 'OK').length;
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
      where: { dateReleve: { gte: sixMoisAgo }, site: siteScope },
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
      where: { site: siteScope },
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
        sitesFaibles,
        sitesOk,
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
    const perimetre = await sitePerimetre(req.user!.id);
    // Les COÛTS (FCFA) sont une lecture de pilotage interne : masqués côté
    // serveur pour tout compte prestataire — les litres suffisent à exploiter.
    const masquerCouts = await estPrestataire(req.user!.id);
    const sites = await prisma.site.findMany({
      where: { isActive: true, ...(region ? { region } : {}), ...perimetre },
      orderBy: { code: 'asc' },
    });
    const stockMap = await dernierStockParSite();

    const data = sites.map((site) => {
      const stock = calculerStockSite(site, { volumeGasoilLitres: stockMap.get(site.id) ?? 0 }, geParams());
      return {
        siteId: site.id, code: site.code, nom: site.nom, region: site.region, statutGE: site.statutGE,
        ...stock,
        ...(masquerCouts ? { coutMoisFCFA: null } : {}),
      };
    });

    const resume = {
      totalLitres: data.reduce((s, x) => s + x.stockLitres, 0),
      totalLitresMois: data.reduce((s, x) => s + x.litresMois, 0),
      totalCoutMoisFCFA: masquerCouts ? null : data.reduce((s, x) => s + (x.coutMoisFCFA ?? 0), 0),
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
      where: {
        dateReleve: { gte: since },
        ...(site_id ? { siteId: site_id } : {}),
        ...await (async () => { const pr = await sitePerimetre(req.user!.id); return isRestreint(pr) ? { site: pr } : {}; })(),
      },
      orderBy: { dateReleve: 'asc' },
      include: { site: { select: { code: true, nom: true } } },
    });

    const totalKwh = releves.reduce((s, r) => s + Number(r.consommationKwh ?? 0), 0);
    // Gasoil CONSOMMÉ (et non le niveau de cuve volumeGasoilLitres).
    const totalGasoil = releves.reduce((s, r) => s + Number(r.gasoilConsommeLitres ?? 0), 0);
    const totalHeuresGE = releves.reduce((s, r) => s + Number(r.heuresFonctGE ?? 0), 0);
    const coutTotal = releves.reduce((s, r) => s + Number(r.coutEstime ?? 0), 0);

    res.json({
      success: true,
      data: {
        periodeJours: parseInt(periode),
        totaux: { consoKwh: Math.round(totalKwh), gasoilLitres: Math.round(totalGasoil), heuresGE: Math.round(totalHeuresGE), coutFCFA: coutTotal },
        nbReleves: releves.length,
        releves: releves.map((r) => ({
          date: r.dateReleve, site: r.site?.nom ?? r.site?.code, source: r.source,
          consommationKwh: r.consommationKwh != null ? Number(r.consommationKwh) : null,
          gasoilConsommeLitres: r.gasoilConsommeLitres != null ? Number(r.gasoilConsommeLitres) : null,
          heuresFonctGE: r.heuresFonctGE != null ? Number(r.heuresFonctGE) : null,
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
    const pMnt = await sitePerimetre(req.user!.id);
    const where = { datePlanifiee: { gte: since }, ...((region || isRestreint(pMnt)) ? { site: { ...(region ? { region } : {}), ...pMnt } } : {}) };

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
      where: {
        dateOuverture: { gte: since },
        ...await (async () => { const pr = await sitePerimetre(req.user!.id); return (region || isRestreint(pr)) ? { site: { ...(region ? { region } : {}), ...pr } } : {}; })(),
      },
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

  const [sitesActifs, incidents, maintenances, depotages, releves, manquants] = await Promise.all([
    prisma.site.count({ where: { isActive: true, ...(region ? { region } : {}) } }),
    prisma.incident.findMany({ where: { dateOuverture: { gte: debut, lte: fin }, ...siteRegion }, select: { statut: true, dureeCoupureMinutes: true, delaiInterventionMinutes: true } }),
    prisma.maintenance.findMany({ where: { datePlanifiee: { gte: debut, lte: fin }, ...siteRegion }, select: { type: true } }),
    prisma.depotage.findMany({ where: { dateDepotage: { gte: debut, lte: fin }, ...siteRegion }, select: { volumeLitres: true, coutTotal: true } }),
    prisma.releveEnergie.findMany({ where: { dateReleve: { gte: debut, lte: fin }, ...siteRegion }, select: { consommationKwh: true, coutEstime: true } }),
    computeManquants({ annee, mois, region }),
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
    manquants: {
      totalLitres: manquants.totaux.manquantSitesLitres,
      nbSites: manquants.totaux.nbSitesManquants,
      // Compteur camion seulement en national (non régionalisable).
      nbCamionsEcart: region ? undefined : manquants.totaux.nbCamionsEcart,
      topSites: manquants.parSite.slice(0, 5).map((s) => ({ code: s.siteCode, manquant: s.manquant })),
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
      subject: `Rapport mensuel E&M OpS - ${String(mo).padStart(2, '0')}/${an}`,
      html: `<p>Bonjour,</p><p>Veuillez trouver ci-joint le rapport mensuel d'exploitation (${String(mo).padStart(2, '0')}/${an}).</p>`,
      attachments: [{ filename: `rapport-${an}-${String(mo).padStart(2, '0')}.pdf`, content: pdf, contentType: 'application/pdf' }],
    });

    await auditLog(req.user!.id, 'EXPORT', 'rapport_mensuel', undefined, { annee: an, mois: mo, destinataires, sent }, req);
    res.json({ success: true, message: sent ? 'Rapport envoyé' : 'SMTP non configuré - rapport non envoyé', data: { sent } });
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
        ...await (async () => { const pr = await sitePerimetre(req.user!.id); return (region || isRestreint(pr)) ? { site: { ...(region ? { region } : {}), ...pr } } : {}; })(),
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

/**
 * Sites suspects de perte/vol de carburant, triés par score. S'appuie sur les
 * écarts déjà réconciliés à chaque dépotage (surconsommation, manquant livraison).
 */
export async function getAnomaliesCarburant(req: Request, res: Response, next: NextFunction) {
  try {
    const jours = req.query.jours ? parseInt(String(req.query.jours), 10) : 90;
    const tous = await detectFuelAnomalies({ jours });
    // Par défaut on ne renvoie que les sites réellement à risque (score > 0),
    // sauf ?all=true (export/analyse complète).
    const data = String(req.query.all) === 'true' ? tous : tous.filter((s) => s.score > 0);
    const totalPerteFCFA = data.reduce((s, x) => s + x.perteFCFA, 0);
    const totalPerteLitres = data.reduce((s, x) => s + x.perteTotaleLitres, 0);
    res.json({
      success: true,
      data,
      meta: {
        jours,
        nbSites: data.length,
        critiques: data.filter((s) => s.niveau === 'CRITIQUE').length,
        suspects: data.filter((s) => s.niveau === 'SUSPECT').length,
        totalPerteLitres,
        totalPerteFCFA,
      },
    });
  } catch (err) { next(err); }
}

/**
 * Tableau de bord Direction : indicateurs consolidés et financiers sur une
 * fenêtre de N mois (coûts énergie, pertes carburant, tendance, top sites,
 * performance maintenance/incidents). S'appuie sur les données déjà agrégées.
 */
export async function getDashboardDirection(req: Request, res: Response, next: NextFunction) {
  try {
    const mois = req.query.mois ? Math.max(1, Math.min(24, parseInt(String(req.query.mois), 10))) : 6;
    const depuis = startOfMonth(subMonths(new Date(), mois - 1));

    const [releves, maints, incidents, anomalies, nbSitesActifs] = await Promise.all([
      prisma.releveEnergie.findMany({
        where: { dateReleve: { gte: depuis } },
        select: { dateReleve: true, source: true, coutEstime: true, gasoilConsommeLitres: true, consommationKwh: true,
          site: { select: { id: true, code: true, nom: true, region: true } } },
      }),
      prisma.maintenance.findMany({
        where: { datePlanifiee: { gte: depuis } },
        select: { type: true, statut: true },
      }),
      prisma.incident.findMany({
        where: { dateOuverture: { gte: depuis } },
        select: { statut: true, dureeCoupureMinutes: true, delaiInterventionMinutes: true, site: { select: { region: true } } },
      }),
      detectFuelAnomalies({ jours: mois * 30 }),
      prisma.site.count({ where: { isActive: true } }),
    ]);

    // ── Coûts énergie (gasoil vs CEET) + série mensuelle ──
    const moisKeys: string[] = [];
    for (let i = mois - 1; i >= 0; i--) moisKeys.push(format(subMonths(new Date(), i), 'MMM yy'));
    const serie = new Map(moisKeys.map((k) => [k, { mois: k, coutGasoil: 0, coutCeet: 0, gasoilLitres: 0 }]));
    let coutGasoil = 0, coutCeet = 0, gasoilLitres = 0;
    // Empreinte carbone dérivée des mêmes relevés (scope 1 GE, scope 2 réseau, solaire évité).
    const cf = carboneFactors();
    let co2GeKg = 0, co2CeetKg = 0, solaireKwh = 0;
    const parRegion = new Map<string, { region: string; coutEnergie: number; gasoilLitres: number; incidents: number }>();
    const parSite = new Map<string, { code: string; nom: string; region: string; coutEnergie: number }>();

    for (const r of releves) {
      const cout = r.coutEstime != null ? Number(r.coutEstime) : 0;
      const litres = r.gasoilConsommeLitres != null ? Number(r.gasoilConsommeLitres) : 0;
      const kwh = r.consommationKwh != null ? Number(r.consommationKwh) : 0;
      const key = format(r.dateReleve, 'MMM yy');
      const bucket = serie.get(key);
      if (r.source === 'GE') { coutGasoil += cout; gasoilLitres += litres; co2GeKg += co2GasoilKg(litres, cf); if (bucket) { bucket.coutGasoil += cout; bucket.gasoilLitres += litres; } }
      else if (r.source === 'CEET') { coutCeet += cout; co2CeetKg += co2ReseauKg(kwh, cf); if (bucket) bucket.coutCeet += cout; }
      else if (r.source === 'SOLAIRE') { solaireKwh += kwh; }

      const reg = r.site?.region ?? '—';
      const pr = parRegion.get(reg) ?? { region: reg, coutEnergie: 0, gasoilLitres: 0, incidents: 0 };
      pr.coutEnergie += cout; pr.gasoilLitres += litres; parRegion.set(reg, pr);

      if (r.site) {
        const ps = parSite.get(r.site.id) ?? { code: r.site.code, nom: r.site.nom, region: r.site.region, coutEnergie: 0 };
        ps.coutEnergie += cout; parSite.set(r.site.id, ps);
      }
    }
    for (const i of incidents) {
      const reg = i.site?.region ?? '—';
      const pr = parRegion.get(reg) ?? { region: reg, coutEnergie: 0, gasoilLitres: 0, incidents: 0 };
      pr.incidents += 1; parRegion.set(reg, pr);
    }

    // ── Performance maintenance (respect du préventif) ──
    const prev = maints.filter((m) => m.type === 'PREVENTIVE');
    const prevRealisees = prev.filter((m) => m.statut === 'TERMINEE').length;
    const curatives = maints.filter((m) => m.type === 'CURATIVE').length;

    // ── Incidents : MTTR / MTTA ──
    const resolus = incidents.filter((i) => i.dureeCoupureMinutes != null);
    const mttr = resolus.length ? Math.round(resolus.reduce((s, i) => s + (i.dureeCoupureMinutes ?? 0), 0) / resolus.length) : null;
    const avecDelai = incidents.filter((i) => i.delaiInterventionMinutes != null);
    const mtta = avecDelai.length ? Math.round(avecDelai.reduce((s, i) => s + (i.delaiInterventionMinutes ?? 0), 0) / avecDelai.length) : null;

    const pertesFCFA = anomalies.reduce((s, a) => s + a.perteFCFA, 0);
    const pertesLitres = anomalies.reduce((s, a) => s + a.perteTotaleLitres, 0);

    res.json({
      success: true,
      data: {
        periodeMois: mois,
        kpis: {
          coutEnergieFCFA: Math.round(coutGasoil + coutCeet),
          coutGasoilFCFA: Math.round(coutGasoil),
          coutCeetFCFA: Math.round(coutCeet),
          gasoilLitres: Math.round(gasoilLitres),
          pertesCarburantFCFA: pertesFCFA,
          pertesCarburantLitres: pertesLitres,
          partPertes: gasoilLitres > 0 ? Math.round((pertesLitres / gasoilLitres) * 100) : 0,
          nbSitesActifs,
          tauxPreventif: prev.length ? Math.round((prevRealisees / prev.length) * 100) : null,
          preventivesRealisees: prevRealisees,
          preventivesPlanifiees: prev.length,
          curatives,
          incidentsTotal: incidents.length,
          incidentsOuverts: incidents.filter((i) => ['OUVERT', 'EN_COURS'].includes(i.statut)).length,
          mttrMinutes: mttr,
          mttaMinutes: mtta,
          co2TotalTonnes: Math.round(((co2GeKg + co2CeetKg) / 1000) * 10) / 10,
          co2GasoilTonnes: Math.round((co2GeKg / 1000) * 10) / 10,
          co2CeetTonnes: Math.round((co2CeetKg / 1000) * 10) / 10,
          co2EviteTonnes: Math.round(((solaireKwh * cf.reseauKgCO2Kwh) / 1000) * 10) / 10,
        },
        serieMensuelle: Array.from(serie.values()).map((s) => ({
          mois: s.mois, coutGasoil: Math.round(s.coutGasoil), coutCeet: Math.round(s.coutCeet), gasoilLitres: Math.round(s.gasoilLitres),
        })),
        parRegion: Array.from(parRegion.values())
          .map((r) => ({ ...r, coutEnergie: Math.round(r.coutEnergie), gasoilLitres: Math.round(r.gasoilLitres) }))
          .sort((a, b) => b.coutEnergie - a.coutEnergie),
        topSitesCouteux: Array.from(parSite.values())
          .map((s) => ({ ...s, coutEnergie: Math.round(s.coutEnergie) }))
          .sort((a, b) => b.coutEnergie - a.coutEnergie)
          .slice(0, 10),
      },
    });
  } catch (err) { next(err); }
}

/**
 * Empreinte carbone du parc (tCO₂) sur N mois, dérivée des relevés d'énergie :
 * gasoil GE (scope 1) + réseau CEET (scope 2), et émissions évitées par le solaire.
 */
export async function getEmpreinteCarbone(req: Request, res: Response, next: NextFunction) {
  try {
    const mois = req.query.mois ? Math.max(1, Math.min(24, parseInt(String(req.query.mois), 10))) : 6;
    res.json({ success: true, data: await computeEmpreinteCarbone({ mois }) });
  } catch (err) { next(err); }
}

/** Fiabilité des GE par marque (pannes rapportées au parc + MTBF). */
export async function getFiabiliteGE(req: Request, res: Response, next: NextFunction) {
  try {
    const jours = req.query.jours ? parseInt(String(req.query.jours), 10) : 180;
    const data = await geReliabilityByMarque({ jours });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

/** Conformité SLA par prestataire (respect délais + préventif, pénalités). */
export async function getSlaPrestataires(req: Request, res: Response, next: NextFunction) {
  try {
    const jours = req.query.jours ? parseInt(String(req.query.jours), 10) : 90;
    const rapport = await computeSla({ jours });

    // Un compte PRESTATAIRE (superviseur) ne voit que SA ligne : ses propres
    // indicateurs et pénalités — jamais ceux des concurrents. Le total de
    // pénalités est recalculé sur ce périmètre (le total parc en dirait trop).
    const me = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { prestataireId: true } });
    if (me?.prestataireId) {
      const miennes = rapport.parPrestataire.filter((p) => p.prestataireId === me.prestataireId);
      return res.json({
        success: true,
        data: {
          ...rapport,
          parPrestataire: miennes,
          penaliteTotaleFCFA: miennes.reduce((s, p) => s + p.penaliteFCFA, 0),
        },
      });
    }
    res.json({ success: true, data: rapport });
  } catch (err) { next(err); }
}

/**
 * Rapport gardiennage : par société, sites gardés et présence de l'agent lors
 * des interventions clôturées (déclaration « Agent présent » du technicien).
 */
export async function getRapportGardiennage(req: Request, res: Response, next: NextFunction) {
  try {
    const jours = Math.max(1, parseInt((req.query.jours as string) ?? '90'));
    const since = new Date(Date.now() - jours * 86400000);

    const societes = await prisma.prestataire.findMany({
      where: { isGardiennage: true, isActive: true },
      select: {
        id: true, nom: true, contactTechnique: true,
        sitesGardes: { where: { isActive: true }, select: { id: true, code: true, hasGardien: true, gardiennageNuitSeulement: true } },
      },
      orderBy: { nom: 'asc' },
    });

    // Postes de NUIT : hors plage (défaut 18h→6h GMT), l'absence est normale —
    // la déclaration est classée « hors plage » et ne pèse pas dans le taux.
    const nuitDebut = getNum('gardiennage.nuitDebutHeure', 18);
    const nuitFin = getNum('gardiennage.nuitFinHeure', 6);
    const dansPlageNuit = (d: Date | null): boolean => {
      if (!d) return true; // date inconnue : on ne présume pas, la déclaration compte
      const h = d.getUTCHours();
      // Plage qui traverse minuit (18→6) ou non (ex. 0→8).
      return nuitDebut > nuitFin ? (h >= nuitDebut || h < nuitFin) : (h >= nuitDebut && h < nuitFin);
    };

    const data = await Promise.all(societes.map(async (soc) => {
      // Seuls les sites où un gardien est effectivement déclaré comptent : une
      // absence sur un site sans poste de gardien ne doit pas pénaliser la société.
      const sitesAvecGardien = soc.sitesGardes.filter((s) => s.hasGardien);
      const siteIds = sitesAvecGardien.map((s) => s.id);
      const nuitSeule = new Set(sitesAvecGardien.filter((s) => s.gardiennageNuitSeulement).map((s) => s.id));
      const [maint, inc, deps] = siteIds.length ? await Promise.all([
        prisma.maintenance.findMany({
          where: { siteId: { in: siteIds }, statut: 'TERMINEE', dateFin: { gte: since } },
          select: { agentPresent: true, siteId: true, dateFin: true },
        }),
        prisma.incident.findMany({
          where: { siteId: { in: siteIds }, dateResolution: { gte: since } },
          select: { agentPresent: true, siteId: true, dateResolution: true },
        }),
        prisma.depotage.findMany({
          where: { siteId: { in: siteIds }, dateDepotage: { gte: since } },
          select: { agentPresent: true, siteId: true, dateDepotage: true },
        }),
      ]) : [[], [], []];
      const decls = [
        ...maint.map((x) => ({ v: x.agentPresent, siteId: x.siteId, quand: x.dateFin })),
        ...inc.map((x) => ({ v: x.agentPresent, siteId: x.siteId, quand: x.dateResolution })),
        ...deps.map((x) => ({ v: x.agentPresent, siteId: x.siteId, quand: x.dateDepotage })),
      ];
      // Une déclaration sur un site « nuit seulement » ne compte dans le taux
      // que si le passage a eu lieu PENDANT le poste. Un « présent » de jour
      // reste hors plage aussi : l'agent n'était pas censé y être, la mesure
      // ne veut rien dire pour le contrat.
      const comptees = decls.filter((d) => !nuitSeule.has(d.siteId) || dansPlageNuit(d.quand));
      const horsPlage = decls.length - comptees.length;
      const presents = comptees.filter((d) => d.v === true).length;
      const absents = comptees.filter((d) => d.v === false).length;
      const nonRenseigne = comptees.filter((d) => d.v == null).length;
      const renseignes = presents + absents;
      return {
        prestataireId: soc.id,
        nom: soc.nom,
        contactTechnique: soc.contactTechnique,
        nbSites: sitesAvecGardien.length,
        nbSitesNuit: nuitSeule.size,
        interventions: decls.length,
        presents, absents, nonRenseigne, horsPlage,
        tauxAbsencePct: renseignes ? Math.round((absents / renseignes) * 100) : null,
      };
    }));

    // Sites avec gardien déclaré mais sans société rapprochée (reste à normaliser).
    const orphelins = await prisma.site.count({
      where: { isActive: true, hasGardien: true, gardiennagePrestataireId: null },
    });

    res.json({ success: true, data: { periodeJours: jours, societes: data, sitesNonRattaches: orphelins } });
  } catch (err) { next(err); }
}

const MOIS_LABELS = ['', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

/** Bornes de période du bilan carburant : jour plein, fin bornée à maintenant. */
function bornesBilan(req: Request): { debut: Date; fin: Date } {
  const { debut, fin } = req.query as Record<string, string>;
  const d = debut ? new Date(`${debut}T00:00:00.000Z`) : null;
  // La borne de fin est INCLUSIVE (fin de journée) : « au 31 » veut dire 31 compris.
  const f = fin ? new Date(`${fin}T23:59:59.999Z`) : null;
  if (!d || !f || Number.isNaN(d.getTime()) || Number.isNaN(f.getTime())) {
    throw new AppError('Période invalide : paramètres debut et fin requis (AAAA-MM-JJ).', 400);
  }
  if (f <= d) throw new AppError('La fin de période doit suivre le début.', 400);
  const maintenant = new Date();
  return { debut: d, fin: f > maintenant ? maintenant : f };
}

/**
 * Portée des bilans : un compte prestataire ne voit que les sites de SES lots
 * (même schéma que le rapport de disponibilité) — les internes voient le parc.
 * La clé de cache est l'utilisateur : deux prestataires ne partagent jamais
 * une entrée mémoïsée.
 */
async function porteeBilan(req: Request): Promise<{ where: Record<string, unknown>; cle: string } | undefined> {
  const perimetre = await sitePerimetre(req.user!.id);
  return isRestreint(perimetre) ? { where: perimetre, cle: req.user!.id } : undefined;
}

/**
 * Bilan carburant sur période : stock aux deux bornes, consommation par
 * conservation, détail par site, courbe 12 mois.
 */
export async function getBilanCarburant(req: Request, res: Response, next: NextFunction) {
  try {
    const { debut, fin } = bornesBilan(req);
    const data = await bilanCarburant(debut, fin, (req.query.region as string) || undefined, await porteeBilan(req));
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function exportBilanCarburant(req: Request, res: Response, next: NextFunction) {
  try {
    const { debut, fin } = bornesBilan(req);
    const b = await bilanCarburant(debut, fin, (req.query.region as string) || undefined, await porteeBilan(req));
    await auditLog(req.user!.id, 'EXPORT', 'bilan_carburant', undefined, { debut, fin }, req);
    await sendTabular(res, req.params.format, 'bilan-carburant', 'Bilan carburant sur période', [
      {
        name: 'Par site',
        columns: [
          { header: 'Site', key: 'code', width: 14 },
          { header: 'Nom', key: 'nom', width: 24 },
          { header: 'Région', key: 'region', width: 16 },
          { header: 'Stock début (L)', key: 'stockDebut', width: 15 },
          { header: 'Livré (L)', key: 'livre', width: 12 },
          { header: 'Transferts/purges (L)', key: 'mouvements', width: 18 },
          { header: 'Stock fin (L)', key: 'stockFin', width: 14 },
          { header: 'Consommation (L)', key: 'conso', width: 16 },
          { header: 'Théorique (L)', key: 'consoTheorique', width: 14 },
          { header: 'Écart (L)', key: 'ecart', width: 12 },
          { header: 'Mesure', key: 'motifNonMesure', width: 34 },
        ],
        rows: b.lignes.map((l) => ({
          ...l,
          stockDebut: l.stockDebut ?? '', stockFin: l.stockFin ?? '',
          conso: l.conso ?? '', ecart: l.ecart ?? '',
          motifNonMesure: l.motifNonMesure ?? 'Mesuré',
        })) as unknown as Record<string, unknown>[],
      },
      {
        name: 'Courbe 12 mois',
        columns: [
          { header: 'Mois', key: 'label', width: 16 },
          { header: 'Livré (L)', key: 'livre', width: 14 },
          { header: 'Consommé mesuré (L)', key: 'conso', width: 20 },
          { header: 'Sites mesurés', key: 'nbSitesMesures', width: 14 },
        ],
        rows: b.courbe.map((c) => ({
          label: `${MOIS_LABELS[c.mois]} ${c.annee}`,
          livre: c.livre, conso: c.conso ?? '', nbSitesMesures: `${c.nbSitesMesures}/${c.nbSites}`,
        })) as unknown as Record<string, unknown>[],
      },
    ],
    `Du ${debut.toLocaleDateString('fr-FR')} au ${fin.toLocaleDateString('fr-FR')} · ` +
    `stock ${b.totaux.stockDebutLitres.toLocaleString('fr-FR')} → ${b.totaux.stockFinLitres.toLocaleString('fr-FR')} L · ` +
    `livré ${b.totaux.livreLitres.toLocaleString('fr-FR')} L · consommé ${b.totaux.consoLitres.toLocaleString('fr-FR')} L ` +
    `(${b.totaux.nbSitesMesures}/${b.totaux.nbSites} sites mesurés)`);
  } catch (err) { next(err); }
}

/** Bilan énergie commerciale (CEET) sur période : index aux bornes, conso, courbe 12 mois. */
export async function getBilanEnergie(req: Request, res: Response, next: NextFunction) {
  try {
    const { debut, fin } = bornesBilan(req);
    const data = await bilanEnergie(debut, fin, (req.query.region as string) || undefined, await porteeBilan(req));
    // Compte prestataire : les kWh restent (exploitation), les FCFA et le prix
    // du kWh NÉGOCIÉ partent — structure de coûts interne de l'opérateur.
    if (await estPrestataire(req.user!.id)) {
      return res.json({
        success: true,
        data: {
          ...data,
          prixKwh: null,
          totaux: { ...data.totaux, coutFCFA: null },
          lignes: data.lignes.map((l) => ({ ...l, coutFCFA: null })),
          courbe: data.courbe.map((p) => ({ ...p, coutFCFA: null })),
        },
      });
    }
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function exportBilanEnergie(req: Request, res: Response, next: NextFunction) {
  try {
    const { debut, fin } = bornesBilan(req);
    const b = await bilanEnergie(debut, fin, (req.query.region as string) || undefined, await porteeBilan(req));
    await auditLog(req.user!.id, 'EXPORT', 'bilan_energie', undefined, { debut, fin }, req);
    await sendTabular(res, req.params.format, 'bilan-energie', 'Bilan énergie CEET sur période', [
      {
        name: 'Par site',
        columns: [
          { header: 'Site', key: 'code', width: 14 },
          { header: 'Nom', key: 'nom', width: 24 },
          { header: 'Région', key: 'region', width: 16 },
          { header: 'Index début (kWh)', key: 'indexDebut', width: 16 },
          { header: 'Index fin (kWh)', key: 'indexFin', width: 16 },
          { header: 'Consommation (kWh)', key: 'consoKwh', width: 18 },
          { header: 'Coût (FCFA)', key: 'coutFCFA', width: 14 },
          { header: 'Relevés', key: 'nbReleves', width: 10 },
          { header: 'Source', key: 'sourceLabel', width: 34 },
        ],
        rows: b.lignes.map((l) => ({
          ...l,
          indexDebut: l.indexDebut ?? '', indexFin: l.indexFin ?? '',
          consoKwh: l.consoKwh ?? '', coutFCFA: l.coutFCFA ?? '',
          sourceLabel: l.source === 'index' ? 'Delta index compteur' : l.motif ?? '',
        })) as unknown as Record<string, unknown>[],
      },
      {
        name: 'Courbe 12 mois',
        columns: [
          { header: 'Mois', key: 'label', width: 16 },
          { header: 'Conso index (kWh)', key: 'consoKwh', width: 18 },
          { header: 'Conso déclarée (kWh)', key: 'declareKwh', width: 20 },
          { header: 'Coût (FCFA)', key: 'coutFCFA', width: 14 },
          { header: 'Sites mesurés', key: 'nbSitesMesures', width: 14 },
        ],
        rows: b.courbe.map((c) => ({
          label: `${MOIS_LABELS[c.mois]} ${c.annee}`,
          consoKwh: c.consoKwh ?? '', declareKwh: c.declareKwh, coutFCFA: c.coutFCFA,
          nbSitesMesures: `${c.nbSitesMesures}/${c.nbSites}`,
        })) as unknown as Record<string, unknown>[],
      },
    ],
    `Du ${debut.toLocaleDateString('fr-FR')} au ${fin.toLocaleDateString('fr-FR')} · ` +
    `${b.totaux.consoKwh.toLocaleString('fr-FR')} kWh · ${b.totaux.coutFCFA.toLocaleString('fr-FR')} FCFA · ` +
    `${b.totaux.nbSitesMesures}/${b.totaux.nbSites} sites au delta d'index (tarif ${b.prixKwh} FCFA/kWh)`);
  } catch (err) { next(err); }
}
