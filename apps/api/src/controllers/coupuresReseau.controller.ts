import { Request, Response, NextFunction } from 'express';
import ExcelJS from 'exceljs';
import { Readable } from 'stream';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { paginate } from '../utils/paginator';
import { auditLog } from '../services/audit.service';
import { sitePerimetre, isRestreint, assertSiteInPerimetre } from '../utils/perimetre';
import { descendantsTransmission } from '../utils/transmission';
import { genererReference } from '../services/reference.service';
import { notifierIncidentCoupure } from '../services/sms.service';
import { io } from '../server';

export const TECHNOLOGIES = ['2G', '3G', '4G', '5G', 'SITE'] as const;

const minutesEntre = (debut: Date, fin: Date) => Math.max(0, Math.round((fin.getTime() - debut.getTime()) / 60_000));

// Alarmes « énergie » (AE/GE/EN) → indisponibilité pré-classée PASSIF
// (environnement/énergie, responsabilité O&M) ; le technicien affine à la résolution.
const ALARMES_ENERGIE = new Set(['AE', 'GE', 'EN']);

/**
 * Crée (ou rattache) les incidents terrain pour les coupures LOCALES encore en
 * cours sans incident : UN incident par site — les technologies d'un même site
 * rejoignent l'incident déjà ouvert au lieu d'en créer un par ligne. Les
 * coupures héritées (impact aval) ne génèrent jamais d'incident : le travail
 * est sur le site origine. Chaque création est dispatchée par SMS aux contacts
 * du prestataire en charge du site.
 */
export async function rattacherIncidentsCoupures(userId: string): Promise<number> {
  const orphelines = await prisma.coupureReseau.findMany({
    where: { dateFin: null, origine: 'LOCALE', incidentId: null },
    include: { site: { select: { nom: true } } },
    orderBy: { dateDebut: 'asc' },
  });
  if (!orphelines.length) return 0;

  const parSite = new Map<string, typeof orphelines>();
  for (const c of orphelines) {
    const l = parSite.get(c.siteId) ?? [];
    l.push(c);
    parSite.set(c.siteId, l);
  }

  let crees = 0;
  for (const [siteId, coupures] of parSite) {
    // Incident auto déjà ouvert pour ce site (créé par une coupure précédente) ?
    let incident = await prisma.incident.findFirst({
      where: { siteId, statut: { in: ['OUVERT', 'EN_COURS'] }, coupures: { some: {} } },
      select: { id: true, reference: true },
    });
    const technos = coupures.map((c) => c.technologie);
    if (!incident) {
      const siteEntier = technos.includes('SITE');
      incident = await prisma.$transaction(async (tx) => tx.incident.create({
        data: {
          reference: await genererReference(tx, 'INC', new Date()),
          siteId,
          type: siteEntier ? 'COUPURE_TOTALE' : 'ALARME',
          severite: siteEntier ? 'CRITIQUE' : 'MAJEUR',
          description: `Coupure réseau ${[...new Set(technos)].join('/')} signalée par le NOC${coupures[0].typeAlarme ? ` (alarme ${coupures[0].typeAlarme})` : ''}.`,
          declarePar: userId,
        },
        select: { id: true, reference: true },
      }));
      crees++;
      io.of('/supervision').emit('incident:created', { id: incident.id, siteId });
      await notifierIncidentCoupure(
        siteId,
        `[E&M OpS] NOC : coupure ${[...new Set(technos)].join('/')} sur ${coupures[0].site.nom}. Incident ${incident.reference ?? ''} à traiter.`,
        'INCIDENT_COUPURE_NOC'
      );
    }
    await prisma.coupureReseau.updateMany({
      where: { id: { in: coupures.map((c) => c.id) } },
      data: { incidentId: incident.id },
    });
    // Pré-classement : alarme énergie → PASSIF (affinable à la résolution).
    const passives = coupures.filter((c) => c.typeAlarme && ALARMES_ENERGIE.has(c.typeAlarme));
    if (passives.length) {
      await prisma.coupureReseau.updateMany({
        where: { id: { in: passives.map((c) => c.id) }, causeCategorie: null },
        data: { causeCategorie: 'PASSIF' },
      });
    }
  }
  return crees;
}

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
      {
        where,
        orderBy: { dateDebut: 'desc' },
        include: {
          site: { select: { nom: true, region: true } },
          coupureOrigine: { select: { id: true, site: { select: { nom: true } } } },
          incident: { select: { id: true, reference: true, statut: true } },
          _count: { select: { heritees: true } },
        },
      },
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

    // Propagation à l'AVAL de transmission : les descendants perdent leur lien
    // → une coupure SITE entier « héritée » par site aval, liée à la racine.
    let sitesImpactes = 0;
    if (b.propagerAval === true) {
      const aval = await descendantsTransmission(siteId);
      if (aval.length) {
        const racineId = rows[0].id;
        await prisma.coupureReseau.createMany({
          data: aval.map((s) => ({
            siteId: s.id,
            technologie: 'SITE',
            dateDebut,
            cause: champs.cause ?? `Coupure amont — propagation transmission`,
            typeAlarme: champs.typeAlarme,
            origine: 'HERITEE',
            coupureOrigineId: racineId,
          })),
          skipDuplicates: true,
        });
        sitesImpactes = aval.length;
      }
    }

    // Incident terrain automatique (groupé par site) + dispatch SMS prestataire,
    // uniquement pour une coupure encore EN COURS (pas la saisie d'historique).
    const incidentsCrees = await rattacherIncidentsCoupures(req.user!.id);

    await auditLog(req.user!.id, 'CREATE', 'coupure_reseau', rows[0].id, { siteId, technologies, sitesImpactes, incidentsCrees }, req);
    res.status(201).json({ success: true, data: { coupures: rows, sitesImpactes, incidentsCrees } });
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
    // Classement de l'indisponibilité (corrigeable par le NOC) : ACTIF ou PASSIF.
    if ('causeCategorie' in b) {
      const cc = b.causeCategorie == null || b.causeCategorie === '' ? null : String(b.causeCategorie).toUpperCase();
      if (cc != null && !['ACTIF', 'PASSIF'].includes(cc)) throw new AppError('causeCategorie invalide (ACTIF ou PASSIF)', 400);
      data.causeCategorie = cc;
    }
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

    // Clôture en cascade : rétablir la racine rétablit les coupures héritées
    // encore ouvertes (même heure de fin, downtime calculé pour chacune).
    let hériteesCloturees = 0;
    if (data.dateFin instanceof Date && b.cloturerHeritees !== false) {
      const fin = data.dateFin;
      const ouvertes = await prisma.coupureReseau.findMany({
        where: { coupureOrigineId: existing.id, dateFin: null },
        select: { id: true, dateDebut: true },
      });
      if (ouvertes.length) {
        await prisma.$transaction(ouvertes.map((h) =>
          prisma.coupureReseau.update({
            where: { id: h.id },
            data: { dateFin: fin, downtimeMinutes: minutesEntre(h.dateDebut, fin), actions: (data.actions as string | null) ?? undefined },
          })
        ));
        hériteesCloturees = ouvertes.length;
      }
    }

    // Réouverture par le NOC (dateFin retirée) : si l'incident lié a été résolu
    // par le technicien, il est ROUVERT — le terrain doit repasser. Tracé + SMS.
    let incidentRouvert = false;
    if ('dateFin' in data && data.dateFin === null && existing.dateFin !== null && existing.incidentId) {
      const incident = await prisma.incident.findUnique({
        where: { id: existing.incidentId },
        select: { id: true, reference: true, statut: true, site: { select: { nom: true } } },
      });
      if (incident && (incident.statut === 'RESOLU' || incident.statut === 'CLOS')) {
        await prisma.incident.update({
          where: { id: incident.id },
          data: { statut: 'EN_COURS', dateResolution: null, dureeCoupureMinutes: null },
        });
        incidentRouvert = true;
        await auditLog(req.user!.id, 'UPDATE', 'incidents', incident.id, { action: 'reouverture_noc', coupureId: existing.id }, req);
        await notifierIncidentCoupure(
          existing.siteId,
          `[E&M OpS] NOC : coupure toujours constatée sur ${incident.site.nom} — incident ${incident.reference ?? ''} ROUVERT, merci de repasser.`,
          'INCIDENT_ROUVERT_NOC'
        );
      }
    }

    await auditLog(req.user!.id, 'UPDATE', 'coupure_reseau', existing.id, { cloture: 'dateFin' in data, hériteesCloturees, incidentRouvert }, req);
    res.json({ success: true, data: { ...updated, hériteesCloturees, incidentRouvert } });
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

/** Sérial Excel (jours depuis 1899-12-30) → Date JS. */
function depuisSerialExcel(serial: number): Date {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86_400_000));
}

/**
 * Combine colonnes date + heure du rapport (heure parfois texte « 08:00:00 »).
 * En lecture en flux, les cellules datées arrivent en NUMÉROS DE SÉRIE Excel
 * (le style de format n'est pas chargé) : new Date('45809') fabriquait
 * l'an 45809, refusé par Prisma. On convertit le sérial, et toute date hors
 * d'une plage plausible est rejetée (ligne signalée plutôt qu'insérée fausse).
 */
function combiner(dateVal: unknown, heureVal: unknown): Date | null {
  if (dateVal == null || dateVal === 'N/A' || dateVal === '-') return null;
  let d: Date;
  if (dateVal instanceof Date) d = new Date(dateVal);
  else if (typeof dateVal === 'number') d = depuisSerialExcel(dateVal);
  else if (/^\d{4,6}(\.\d+)?$/.test(String(dateVal).trim())) d = depuisSerialExcel(Number(dateVal));
  else d = new Date(String(dateVal));
  if (Number.isNaN(d.getTime())) return null;
  // Garde-fou : le rapport NOC ne peut contenir que des dates « récentes ».
  const annee = d.getFullYear();
  if (annee < 2015 || annee > 2035) return null;
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

const cell = (row: { getCell(i: number): { value: unknown } }, i: number): unknown => {
  const v = row.getCell(i).value;
  if (v && typeof v === 'object' && 'result' in (v as object)) return (v as { result: unknown }).result;
  if (v && typeof v === 'object' && 'text' in (v as object)) return (v as { text: unknown }).text;
  return v;
};

/**
 * Import de la feuille « Events » uniquement. Idempotent : l'index d'unicité (site, technologie, fréquence,
 * début) fait qu'un ré-import du rapport cumulatif ne crée pas de doublons.
 */
export async function importCoupures(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) throw new AppError('Fichier .xlsx requis', 400);

    // Rapprochement par nom normalisé (comme l'import de sites).
    const sites = await prisma.site.findMany({ select: { id: true, nom: true, code: true } });
    const parNom = new Map<string, string>();
    for (const s of sites) { parNom.set(norm(s.nom), s.id); parNom.set(norm(s.code), s.id); }

    let crees = 0, doublons = 0;
    const nonApparies = new Map<string, number>();
    const erreurs: Array<{ feuille: string; ligne: number; message: string }> = [];
    const lots: Array<Record<string, unknown>> = [];

    // Traitement d'une ligne d'une feuille utile (Events / SITES HUAWEI).
    type LigneXlsx = { getCell(i: number): { value: unknown }; number: number };
    const traiterLigne = (nomFeuille: string, technoParDefaut: string | null, row: LigneXlsx) => {
      {
        const n = row.number;
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
      }
    };

    // Lecture EN FLUX : le classeur NOC contient des feuilles énormes (« Data »
    // déclarée sur toute la grille Excel) — le chargement complet dépassait la
    // limite mémoire du conteneur (1 Go) et faisait tomber l'API (502).
    // Ici : ligne à ligne (~90 Mo de pointe), feuilles inutiles ignorées.
    // Seule la feuille « Events » fait foi (décision métier) — les autres
    // feuilles du classeur sont parcourues sans être importées.
    const FEUILLES: Record<string, string | null> = { Events: null };
    const lecteur = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(req.file.buffer), {
      entries: 'emit', sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'ignore', worksheets: 'emit',
    });
    for await (const ws of lecteur) {
      const nomFeuille = (ws as unknown as { name?: string }).name ?? '';
      const utile = nomFeuille in FEUILLES;
      for await (const row of ws) {
        if (!utile) continue; // itération nécessaire pour avancer le flux, rien n'est stocké
        traiterLigne(nomFeuille, FEUILLES[nomFeuille], row as unknown as LigneXlsx);
      }
    }
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

    // Les coupures importées ENCORE EN COURS obtiennent leur incident terrain
    // (groupé par site) — l'historique déjà rétabli n'en crée jamais.
    const incidentsCrees = await rattacherIncidentsCoupures(req.user!.id);

    await auditLog(req.user!.id, 'CREATE', 'coupure_reseau', undefined, { import: true, crees, doublons, incidentsCrees }, req);
    res.json({
      success: true,
      data: {
        lignes: lots.length,
        crees,
        doublonsIgnores: doublons,
        incidentsCrees,
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
