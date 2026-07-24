import { Request, Response, NextFunction } from 'express';
import ExcelJS from 'exceljs';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { paginate } from '../utils/paginator';
import { auditLog } from '../services/audit.service';
import { sitePerimetre, isRestreint, assertSiteInPerimetre } from '../utils/perimetre';

export const TECHNOLOGIES = ['2G', '3G', '4G', '5G', 'SITE'] as const;

const minutesEntre = (debut: Date, fin: Date) => Math.max(0, Math.round((fin.getTime() - debut.getTime()) / 60_000));

/** Liste paginée, filtrable ; périmètre prestataire appliqué comme partout. */
export async function getCoupures(req: Request, res: Response, next: NextFunction) {
  try {
    const { site_id, technologie, type_alarme, statut, date_debut, date_fin, search, page = '1', limit = '20' } =
      req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (site_id) where.siteId = site_id;
    if (technologie) where.technologie = technologie;
    if (type_alarme) where.typeAlarme = type_alarme;
    if (statut === 'EN_COURS') where.dateFin = null;
    if (statut === 'TERMINEE') where.dateFin = { not: null };
    if (date_debut || date_fin) {
      where.dateDebut = {
        ...(date_debut ? { gte: new Date(date_debut) } : {}),
        ...(date_fin ? { lte: new Date(date_fin) } : {}),
      };
    }
    const perimetre = await sitePerimetre(req.user!.id);
    if (search || isRestreint(perimetre)) {
      where.site = {
        ...(isRestreint(perimetre) ? perimetre : {}),
        ...(search ? { nom: { contains: search, mode: 'insensitive' } } : {}),
      };
    }
    const { data, meta } = await paginate(
      prisma.coupureReseau,
      { where, orderBy: { dateDebut: 'desc' }, include: { site: { select: { nom: true, region: true } } } },
      { page: parseInt(page), limit: parseInt(limit) }
    );
    res.json({ success: true, data, meta });
  } catch (err) { next(err); }
}

/** Création manuelle — plusieurs technologies d'un coup (une ligne par techno). */
export async function createCoupure(req: Request, res: Response, next: NextFunction) {
  try {
    const b = req.body as Record<string, unknown>;
    const siteId = String(b.siteId ?? '');
    if (!siteId) throw new AppError('Site obligatoire', 400);
    await assertSiteInPerimetre(req.user!.id, siteId);

    const technologies: string[] = Array.isArray(b.technologies) && b.technologies.length
      ? (b.technologies as string[])
      : [String(b.technologie ?? 'SITE')];
    if (technologies.some((t) => !TECHNOLOGIES.includes(t as never))) {
      throw new AppError('Technologie invalide (2G, 3G, 4G, 5G ou SITE)', 400);
    }
    const dateDebut = b.dateDebut ? new Date(String(b.dateDebut)) : null;
    if (!dateDebut || Number.isNaN(dateDebut.getTime())) throw new AppError('Date de début invalide', 400);

    const champs = {
      siteId,
      frequence: b.frequence ? String(b.frequence).slice(0, 30) : null,
      secteur: b.secteur ? String(b.secteur).slice(0, 20) : null,
      dateDebut,
      heureContact: b.heureContact ? new Date(String(b.heureContact)) : null,
      technicienContacte: b.technicienContacte ? String(b.technicienContacte).slice(0, 100) : null,
      cause: b.cause ? String(b.cause).slice(0, 300) : null,
      typeAlarme: b.typeAlarme ? String(b.typeAlarme).slice(0, 10).toUpperCase() : null,
      observations: b.observations ? String(b.observations) : null,
    };
    const rows = await prisma.$transaction(
      technologies.map((technologie) => prisma.coupureReseau.create({ data: { ...champs, technologie } }))
    );
    await auditLog(req.user!.id, 'CREATE', 'coupure_reseau', rows[0].id, { siteId, technologies }, req);
    res.status(201).json({ success: true, data: rows });
  } catch (err) { next(err); }
}

/** Mise à jour / clôture : dateFin renseignée → downtime calculé automatiquement. */
export async function updateCoupure(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.coupureReseau.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Coupure introuvable', 404);
    await assertSiteInPerimetre(req.user!.id, existing.siteId);

    const b = req.body as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    for (const k of ['frequence', 'secteur', 'technicienContacte', 'intervenants', 'cause', 'actions', 'typeAlarme', 'nocEngineer', 'observations'] as const) {
      if (k in b) data[k] = b[k] == null || b[k] === '' ? null : String(b[k]);
    }
    if (typeof data.typeAlarme === 'string') data.typeAlarme = data.typeAlarme.slice(0, 10).toUpperCase();
    for (const k of ['heureContact', 'dateArriveeSite', 'dateFin'] as const) {
      if (k in b) {
        const d = b[k] ? new Date(String(b[k])) : null;
        if (d && Number.isNaN(d.getTime())) throw new AppError(`${k} invalide`, 400);
        data[k] = d;
      }
    }
    // Clôture (ou ré-ouverture) → downtime recalculé, jamais saisi à la main.
    if ('dateFin' in data) {
      const fin = data.dateFin as Date | null;
      if (fin && fin < existing.dateDebut) throw new AppError('La fin ne peut pas précéder le début', 400);
      data.downtimeMinutes = fin ? minutesEntre(existing.dateDebut, fin) : null;
    }
    const updated = await prisma.coupureReseau.update({ where: { id: existing.id }, data });
    await auditLog(req.user!.id, 'UPDATE', 'coupure_reseau', existing.id, { cloture: 'dateFin' in data }, req);
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

export async function deleteCoupure(req: Request, res: Response, next: NextFunction) {
  try {
    await prisma.coupureReseau.delete({ where: { id: req.params.id } });
    await auditLog(req.user!.id, 'DELETE', 'coupure_reseau', req.params.id, {}, req);
    res.json({ success: true });
  } catch (err) { next(err); }
}

// ── Import du rapport Excel de supervision NOC ──────────────────────────────

const norm = (s: unknown) =>
  String(s ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]/g, '');

/** Combine colonnes date + heure du rapport (heure parfois texte « 08:00:00 »). */
function combiner(dateVal: unknown, heureVal: unknown): Date | null {
  if (dateVal == null || dateVal === 'N/A' || dateVal === '-') return null;
  const d = dateVal instanceof Date ? new Date(dateVal) : new Date(String(dateVal));
  if (Number.isNaN(d.getTime())) return null;
  if (heureVal instanceof Date) {
    d.setHours(heureVal.getUTCHours(), heureVal.getUTCMinutes(), 0, 0);
  } else if (typeof heureVal === 'string' && /^\d{1,2}:\d{2}/.test(heureVal.trim())) {
    const [h, m] = heureVal.trim().split(':').map((x) => parseInt(x, 10));
    d.setHours(h, m, 0, 0);
  } else if (typeof heureVal === 'number' && heureVal >= 0 && heureVal < 1) {
    const mins = Math.round(heureVal * 24 * 60);
    d.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
  }
  return d;
}

const cell = (row: ExcelJS.Row, i: number): unknown => {
  const v = row.getCell(i).value;
  if (v && typeof v === 'object' && 'result' in (v as object)) return (v as { result: unknown }).result;
  if (v && typeof v === 'object' && 'text' in (v as object)) return (v as { text: unknown }).text;
  return v;
};

/**
 * Import des feuilles « Events » (coupures par cellule) et « SITES HUAWEI »
 * (site entier). Idempotent : l'index d'unicité (site, technologie, fréquence,
 * début) fait qu'un ré-import du rapport cumulatif ne crée pas de doublons.
 */
export async function importCoupures(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) throw new AppError('Fichier .xlsx requis', 400);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.file.buffer as unknown as ArrayBuffer);

    // Rapprochement par nom normalisé (comme l'import de sites).
    const sites = await prisma.site.findMany({ select: { id: true, nom: true, code: true } });
    const parNom = new Map<string, string>();
    for (const s of sites) { parNom.set(norm(s.nom), s.id); parNom.set(norm(s.code), s.id); }

    let crees = 0, doublons = 0;
    const nonApparies = new Map<string, number>();
    const erreurs: Array<{ feuille: string; ligne: number; message: string }> = [];
    const lots: Array<Record<string, unknown>> = [];

    const lireFeuille = (nomFeuille: string, technoParDefaut: string | null) => {
      const ws = wb.getWorksheet(nomFeuille);
      if (!ws) return;
      ws.eachRow((row, n) => {
        if (n === 1) return; // en-têtes
        const siteBrut = cell(row, 1);
        if (!siteBrut || String(siteBrut).trim() === '') return;
        const siteId = parNom.get(norm(siteBrut));
        if (!siteId) {
          nonApparies.set(String(siteBrut).trim(), (nonApparies.get(String(siteBrut).trim()) ?? 0) + 1);
          return;
        }
        const debut = combiner(cell(row, 5), cell(row, 6));
        if (!debut) { erreurs.push({ feuille: nomFeuille, ligne: n, message: 'date de début illisible' }); return; }
        const fin = combiner(cell(row, 7), cell(row, 8));
        const technoBrut = String(cell(row, 2) ?? '').trim();
        // « 2G/3G/4G » (toutes technos) → coupure SITE entier.
        const technologie = technoParDefaut ?? (technoBrut.includes('/') ? 'SITE' : (technoBrut || 'SITE'));
        const freq = String(cell(row, 3) ?? '').trim();
        lots.push({
          siteId,
          technologie: technologie.slice(0, 12),
          frequence: freq && freq !== '-' ? freq.slice(0, 30) : null,
          secteur: String(cell(row, 4) ?? '').trim().slice(0, 20) || null,
          dateDebut: debut,
          dateFin: fin,
          downtimeMinutes: fin ? minutesEntre(debut, fin) : null,
          heureContact: combiner(cell(row, 13), cell(row, 12)),
          technicienContacte: String(cell(row, 14) ?? '').trim().slice(0, 100) || null,
          dateArriveeSite: combiner(cell(row, 15), cell(row, 16)),
          intervenants: String(cell(row, 18) ?? '').trim().slice(0, 200) || null,
          cause: String(cell(row, 19) ?? '').trim().slice(0, 300) || null,
          actions: String(cell(row, 20) ?? '').trim().slice(0, 300) || null,
          typeAlarme: String(cell(row, 21) ?? '').trim().slice(0, 10).toUpperCase() || null,
          nocEngineer: String(cell(row, 23) ?? '').trim().slice(0, 100) || null,
          observations: String(cell(row, 22) ?? '').trim() || null,
        });
      });
    };

    lireFeuille('Events', null);
    lireFeuille('SITES HUAWEI', 'SITE');
    if (!lots.length && !nonApparies.size) throw new AppError("Aucune feuille « Events » / « SITES HUAWEI » exploitable", 400);

    // Nettoyage des valeurs textuelles parasites du rapport (« - », « N/A », « #N/A »).
    for (const l of lots) {
      for (const k of ['technicienContacte', 'intervenants', 'cause', 'actions', 'typeAlarme', 'nocEngineer', 'observations'] as const) {
        const v = l[k];
        if (typeof v === 'string' && ['-', 'N/A', '#N/A', ''].includes(v.trim())) l[k] = null;
      }
    }

    // createMany + skipDuplicates : l'index d'unicité absorbe le ré-import.
    for (let i = 0; i < lots.length; i += 500) {
      const res2 = await prisma.coupureReseau.createMany({
        data: lots.slice(i, i + 500) as never,
        skipDuplicates: true,
      });
      crees += res2.count;
    }
    doublons = lots.length - crees;

    await auditLog(req.user!.id, 'CREATE', 'coupure_reseau', undefined, { import: true, crees, doublons }, req);
    res.json({
      success: true,
      data: {
        lignes: lots.length,
        crees,
        doublonsIgnores: doublons,
        sitesNonApparies: [...nonApparies.entries()].map(([site, lignes]) => ({ site, lignes })).sort((a, b) => b.lignes - a.lignes),
        erreurs: erreurs.slice(0, 50),
      },
    });
  } catch (err) { next(err); }
}

// ── Rapport de disponibilité réseau ─────────────────────────────────────────

export async function getDisponibiliteReseau(req: Request, res: Response, next: NextFunction) {
  try {
    const mois = req.query.mois ? Math.max(1, Math.min(24, parseInt(String(req.query.mois), 10))) : 3;
    const depuis = new Date(); depuis.setMonth(depuis.getMonth() - mois); depuis.setHours(0, 0, 0, 0);
    const maintenant = new Date();
    const fenetreMin = minutesEntre(depuis, maintenant);

    const [coupures, nbSites] = await Promise.all([
      prisma.coupureReseau.findMany({
        where: { OR: [{ dateFin: null }, { dateFin: { gte: depuis } }] },
        include: { site: { select: { id: true, nom: true, region: true } } },
      }),
      prisma.site.count({ where: { isActive: true } }),
    ]);

    let downtimeTotal = 0, downtimeEnergie = 0;
    const parSite = new Map<string, { nom: string; region: string; downtime: number; coupures: number; enCours: number }>();
    const parAlarme = new Map<string, { type: string; coupures: number; downtime: number }>();
    const ENERGIE = new Set(['AE', 'GE', 'EN']);
    let enCours = 0;

    for (const c of coupures) {
      // Downtime borné à la fenêtre d'analyse (une coupure ouverte court jusqu'à maintenant).
      const debut = c.dateDebut < depuis ? depuis : c.dateDebut;
      const fin = c.dateFin ?? maintenant;
      if (fin <= depuis) continue;
      const dt = minutesEntre(debut, fin);
      if (!c.dateFin) enCours++;
      downtimeTotal += dt;
      if (c.typeAlarme && ENERGIE.has(c.typeAlarme)) downtimeEnergie += dt;

      const ps = parSite.get(c.siteId) ?? { nom: c.site.nom, region: c.site.region, downtime: 0, coupures: 0, enCours: 0 };
      ps.downtime += dt; ps.coupures += 1; if (!c.dateFin) ps.enCours += 1;
      parSite.set(c.siteId, ps);

      const ta = c.typeAlarme ?? '—';
      const pa = parAlarme.get(ta) ?? { type: ta, coupures: 0, downtime: 0 };
      pa.coupures += 1; pa.downtime += dt; parAlarme.set(ta, pa);
    }

    res.json({
      success: true,
      data: {
        periodeMois: mois,
        kpis: {
          coupures: coupures.filter((c) => (c.dateFin ?? maintenant) > depuis).length,
          enCours,
          downtimeHeures: Math.round(downtimeTotal / 60),
          partEnergiePct: downtimeTotal > 0 ? Math.round((downtimeEnergie / downtimeTotal) * 100) : 0,
          sitesTouches: parSite.size,
          nbSites,
        },
        topSites: [...parSite.values()]
          .map((s) => ({ ...s, downtimeHeures: Math.round(s.downtime / 60), dispoPct: Math.max(0, Math.round((1 - s.downtime / fenetreMin) * 1000) / 10) }))
          .sort((a, b) => b.downtime - a.downtime)
          .slice(0, 15),
        parTypeAlarme: [...parAlarme.values()]
          .map((a) => ({ ...a, downtimeHeures: Math.round(a.downtime / 60) }))
          .sort((a, b) => b.downtime - a.downtime),
      },
    });
  } catch (err) { next(err); }
}
