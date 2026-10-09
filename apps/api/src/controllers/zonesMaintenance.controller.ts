import { Request, Response, NextFunction } from 'express';
import ExcelJS from 'exceljs';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { auditLog } from '../services/audit.service';
import { cacheService } from '../services/cache.service';
import { lireLignes, planifierImport, PlanImport } from '../utils/zonesImport';

/**
 * ZONES DE MAINTENANCE : découpage TERRAIN du parc (LOME 1, KARA…) et leur
 * responsable (FME), pris parmi les contacts SMS. Lecture pour tous les profils
 * qui consultent le parc (la zone et le FME disent qui appeler) ; édition et
 * import réservés à l'ADMIN.
 */

const SELECT_RESPONSABLE = { id: true, nom: true, prenom: true, telephone: true, email: true, societe: true, prestataireId: true } as const;

type Responsable = { id: string; nom: string; prenom: string; telephone: string; email: string | null; societe: string; prestataireId: string | null };

/**
 * Coordonnées du FME : visibles des équipes internes et du prestataire du FME.
 * Un utilisateur d'un AUTRE prestataire voit le nom, pas le téléphone ni l'e-mail.
 */
export function responsableVisible(r: Responsable | null, prestataireUtilisateur: string | null) {
  if (!r) return null;
  const { prestataireId, ...reste } = r;
  if (prestataireUtilisateur && prestataireId !== prestataireUtilisateur) {
    return { ...reste, telephone: null, email: null };
  }
  return reste;
}

export async function prestataireDe(userId: string): Promise<string | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { prestataireId: true } });
  return u?.prestataireId ?? null;
}

export async function listZones(req: Request, res: Response, next: NextFunction) {
  try {
    const prestataire = await prestataireDe(req.user!.id);
    const zones = await prisma.zoneMaintenance.findMany({
      orderBy: { nom: 'asc' },
      select: {
        id: true, nom: true,
        responsable: { select: SELECT_RESPONSABLE },
        _count: { select: { sites: { where: { isActive: true } } } },
      },
    });
    res.json({
      success: true,
      data: zones.map(({ _count, responsable, ...z }) => ({
        ...z, responsable: responsableVisible(responsable, prestataire), nbSites: _count.sites,
      })),
    });
  } catch (err) { next(err); }
}

/** Renomme une zone et/ou change son FME (un contact SMS actif, ou aucun). */
export async function updateZone(req: Request, res: Response, next: NextFunction) {
  try {
    const zone = await prisma.zoneMaintenance.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!zone) throw new AppError('Zone introuvable', 404);
    const b = (req.body ?? {}) as { nom?: unknown; responsableContactId?: unknown };
    const data: { nom?: string; responsableContactId?: string | null } = {};
    if ('nom' in b) {
      const nom = String(b.nom ?? '').trim().replace(/\s+/g, ' ');
      if (!nom || nom.length > 60) throw new AppError('Nom de zone requis (60 caractères au plus).', 422);
      data.nom = nom;
    }
    if ('responsableContactId' in b) {
      const id = b.responsableContactId ? String(b.responsableContactId) : null;
      if (id) {
        const c = await prisma.contact.findUnique({ where: { id }, select: { actif: true } });
        if (!c) throw new AppError('Contact introuvable.', 422);
        if (!c.actif) throw new AppError('Ce contact est désactivé : il ne recevrait aucune alerte.', 422);
      }
      data.responsableContactId = id;
    }
    if (!Object.keys(data).length) throw new AppError('Aucun champ à modifier.', 400);
    const z = await prisma.zoneMaintenance.update({ where: { id: zone.id }, data }).catch((e: { code?: string }) => {
      if (e.code === 'P2002') throw new AppError(`Une zone s'appelle déjà « ${data.nom} ».`, 409);
      throw e;
    });
    await auditLog(req.user!.id, 'UPDATE', 'zones_maintenance', zone.id, data, req);
    res.json({ success: true, data: z });
  } catch (err) { next(err); }
}

/** Supprime une zone ; ses sites redeviennent « sans zone » (rien d'autre ne change). */
export async function deleteZone(req: Request, res: Response, next: NextFunction) {
  try {
    const z = await prisma.zoneMaintenance.findUnique({
      where: { id: req.params.id }, select: { id: true, nom: true, _count: { select: { sites: true } } },
    });
    if (!z) throw new AppError('Zone introuvable', 404);
    await prisma.zoneMaintenance.delete({ where: { id: z.id } });
    await auditLog(req.user!.id, 'DELETE', 'zones_maintenance', z.id, { nom: z.nom, sitesLiberes: z._count.sites }, req);
    await cacheService.invalidate('sites:geojson*');
    res.json({ success: true, data: { sitesLiberes: z._count.sites } });
  } catch (err) { next(err); }
}

async function lireFichier(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer, {
    ignoreNodes: ['dataValidations', 'drawing', 'hyperlinks', 'picture', 'styles', 'conditionalFormatting'],
  });
  const ws = wb.worksheets[0];
  if (!ws || ws.rowCount < 2) throw new AppError('Fichier vide ou sans données.', 400);
  const texte = (row: ExcelJS.Row, i: number) => String(row.getCell(i).text ?? '').trim();
  const largeur = ws.columnCount;
  const entetes = Array.from({ length: largeur }, (_, i) => texte(ws.getRow(1), i + 1));
  const lignes: Array<{ numero: number; cellules: string[] }> = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    lignes.push({ numero: r, cellules: Array.from({ length: largeur }, (_, i) => texte(row, i + 1)) });
  }
  try {
    return lireLignes(entetes, lignes);
  } catch (e) {
    throw new AppError((e as Error).message, 422);
  }
}

async function planDepuisFichier(buffer: Buffer): Promise<PlanImport> {
  const lignes = await lireFichier(buffer);
  if (!lignes.length) throw new AppError('Aucune ligne exploitable (site et zone renseignés).', 422);
  const [sites, contacts, zones] = await Promise.all([
    prisma.site.findMany({ select: { id: true, nom: true, code: true, region: true, isActive: true, zoneMaintenanceId: true } }),
    prisma.contact.findMany({ select: { id: true, nom: true, prenom: true, telephone: true, actif: true } }),
    prisma.zoneMaintenance.findMany({ select: { id: true, nom: true, responsableContactId: true } }),
  ]);
  return planifierImport(
    lignes,
    sites.map((s) => ({ id: s.id, nom: s.nom, code: s.code, region: s.region, isActive: s.isActive, zoneId: s.zoneMaintenanceId })),
    contacts,
    zones,
  );
}

/**
 * Import du fichier « SITENAME / ACTIF MAINTENANCE AREA / FME NAME ».
 * Sans `appliquer=true` : APERÇU seul, rien n'est écrit. Avec : zones créées,
 * FME rattachés quand le contact est trouvé sans ambiguïté, sites affectés.
 * Un site du parc absent du fichier garde sa zone actuelle : l'import ajoute
 * et corrige, il ne vide jamais en silence.
 */
export async function importerZones(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) throw new AppError('Aucun fichier reçu : sélectionnez le fichier Excel des zones.', 400);
    const plan = await planDepuisFichier(req.file.buffer);
    const appliquer = String((req.body as { appliquer?: unknown })?.appliquer ?? '') === 'true';

    // Le code site n'est montré qu'à l'admin (route ADMIN) : ici, uniquement des noms.
    const resume = {
      zones: plan.zones.map((z) => ({
        nom: z.nom, nouvelle: !z.existante, fme: z.fme, fmeProbleme: z.fmeProbleme, nbSites: z.nbSites,
        contact: z.contact ? { id: z.contact.id, nom: z.contact.nom, prenom: z.contact.prenom, telephone: z.contact.telephone } : null,
        changementFme: !!z.contact && z.existante?.responsableContactId !== z.contact.id,
      })),
      affectations: plan.affectations.length,
      changementsDeZone: plan.affectations.filter((a) => a.avant).map((a) => ({ site: a.site, avant: a.avant, apres: a.zone })),
      inchanges: plan.inchanges,
      sitesInconnus: plan.sitesInconnus,
      sitesAmbigus: plan.sitesAmbigus,
      contradictions: plan.contradictions,
      sitesAbsents: plan.sitesAbsents.map(({ nom, region, zoneActuelle }) => ({ nom, region, zoneActuelle })),
    };
    if (!appliquer) return res.json({ success: true, data: { applique: false, ...resume } });

    await prisma.$transaction(async (tx) => {
      const idZone = new Map<string, string>();
      for (const z of plan.zones) {
        const data = z.contact ? { responsableContactId: z.contact.id } : {};
        const enregistree = z.existante
          ? await tx.zoneMaintenance.update({ where: { id: z.existante.id }, data })
          : await tx.zoneMaintenance.create({ data: { nom: z.nom, ...data } });
        idZone.set(z.nom, enregistree.id);
      }
      // Regroupé par zone : huit UPDATE au lieu de sept cents.
      const parZone = new Map<string, string[]>();
      for (const a of plan.affectations) (parZone.get(a.zone) ?? parZone.set(a.zone, []).get(a.zone)!).push(a.siteId);
      for (const [zone, ids] of parZone) {
        await tx.site.updateMany({ where: { id: { in: ids } }, data: { zoneMaintenanceId: idZone.get(zone)! } });
      }
    }, { timeout: 60_000 });

    await auditLog(req.user!.id, 'UPDATE', 'zones_maintenance', undefined, {
      action: 'import', zones: plan.zones.length, sitesAffectes: plan.affectations.length,
      sitesInconnus: plan.sitesInconnus.length, sitesAbsents: plan.sitesAbsents.length,
    }, req);
    await cacheService.invalidate('sites:geojson*');
    res.json({ success: true, data: { applique: true, ...resume } });
  } catch (err) { next(err); }
}
