import { Request, Response, NextFunction } from 'express';
import { FormeCuve, Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { auditLog } from '../services/audit.service';
import { cacheService } from '../services/cache.service';
import { validerPointsBareme } from '../utils/baremeSaisi';
import { hauteurMaxCm, resoudreConfigCuve, volumeMaxLitres } from '../utils/cuve';
import { SITES_AVEC_CARBURANT } from '../utils/perimetreCarburant';
import { SELECT_MODELE_CUVE, configModele, configPropre, configsModeles } from '../services/cuve.service';

/**
 * MODÈLES DE CUVE : la conversion hauteur → litres d'une catégorie de cuves
 * identiques (« Cuve 5000 L »), saisie une fois et partagée par les sites qui
 * en sont équipés. Lecture pour qui modifie les sites (MANAGER, ADMIN) ;
 * édition du référentiel et affectation en masse réservées à l'ADMIN.
 */

const n = (v: Prisma.Decimal | null) => (v != null ? Number(v) : null);

/** Résumé d'un modèle : de quoi juger d'un coup d'œil s'il est utilisable. */
function resume(m: Prisma.ModeleCuveGetPayload<{ select: typeof SELECT_MODELE_CUVE }> & {
  description: string | null; isActive: boolean; _count: { sites: number };
}) {
  const cfg = configModele(m);
  const volumeMax = volumeMaxLitres(cfg);
  const capacite = Number(m.capaciteLitres);
  return {
    id: m.id,
    nom: m.nom,
    capaciteLitres: capacite,
    formeCuve: m.formeCuve,
    longueurCm: n(m.longueurCm),
    largeurCm: n(m.largeurCm),
    hauteurCm: n(m.hauteurCm),
    diametreCm: n(m.diametreCm),
    description: m.description,
    isActive: m.isActive,
    nbPoints: m.baremage.length,
    nbSites: m._count.sites,
    calculable: volumeMax != null,
    conversion: m.baremage.length >= 2 ? 'BAREME' : volumeMax != null ? 'DIMENSIONS' : null,
    hauteurMaxCm: hauteurMaxCm(cfg),
    volumeMaxLitres: volumeMax,
    // Volume à hauteur max comparé à la capacité de la plaque : un grand écart
    // trahit un barème ou des dimensions mal saisis (mm au lieu de cm…).
    ecartCapacitePct: volumeMax != null && capacite > 0
      ? Math.round(((volumeMax - capacite) / capacite) * 1000) / 10
      : null,
  };
}

const SELECT_RESUME = {
  ...SELECT_MODELE_CUVE,
  description: true,
  isActive: true,
  _count: { select: { sites: true } },
} satisfies Prisma.ModeleCuveSelect;

export async function listModelesCuve(_req: Request, res: Response, next: NextFunction) {
  try {
    const modeles = await prisma.modeleCuve.findMany({ select: SELECT_RESUME, orderBy: [{ capaciteLitres: 'desc' }, { nom: 'asc' }] });
    res.json({ success: true, data: modeles.map(resume) });
  } catch (err) { next(err); }
}

export async function getModeleCuve(req: Request, res: Response, next: NextFunction) {
  try {
    const m = await prisma.modeleCuve.findUnique({ where: { id: req.params.id }, select: SELECT_RESUME });
    if (!m) throw new AppError('Modèle de cuve introuvable', 404);
    res.json({
      success: true,
      data: { ...resume(m), baremage: m.baremage.map((p) => ({ hauteurCm: Number(p.hauteurCm), litres: Number(p.litres) })) },
    });
  } catch (err) { next(err); }
}

/** Champs saisis d'un modèle, validés. `partiel` : seuls les champs présents. */
function lireChamps(b: Record<string, unknown>, partiel: boolean): Prisma.ModeleCuveUncheckedUpdateInput {
  const data: Prisma.ModeleCuveUncheckedUpdateInput = {};
  const present = (k: string) => !partiel || k in b;

  if (present('nom')) {
    const nom = String(b.nom ?? '').trim();
    if (!nom || nom.length > 60) throw new AppError('Nom du modèle requis (60 caractères au plus).', 422);
    data.nom = nom;
  }
  if (present('capaciteLitres')) {
    const c = Number(b.capaciteLitres);
    if (!Number.isFinite(c) || c <= 0 || c >= 1e6) throw new AppError('Capacité invalide : un volume en litres, supérieur à 0.', 422);
    data.capaciteLitres = Math.round(c * 100) / 100;
  }
  if (present('formeCuve')) {
    const f = b.formeCuve ? String(b.formeCuve).toUpperCase() : null;
    if (f && !(Object.values(FormeCuve) as string[]).includes(f)) {
      throw new AppError('Forme de cuve invalide (rectangulaire ou cylindre couché).', 422);
    }
    data.formeCuve = f as FormeCuve | null;
  }
  for (const k of ['longueurCm', 'largeurCm', 'hauteurCm', 'diametreCm'] as const) {
    if (!present(k)) continue;
    const v = b[k];
    if (v == null || v === '') { data[k] = null; continue; }
    const d = Number(v);
    if (!Number.isFinite(d) || d <= 0 || d >= 1e4) throw new AppError('Dimension invalide : une longueur intérieure en cm.', 422);
    data[k] = Math.round(d * 10) / 10;
  }
  if (present('description')) {
    const d = b.description == null ? '' : String(b.description).trim();
    if (d.length > 300) throw new AppError('Description trop longue (300 caractères au plus).', 422);
    data.description = d || null;
  }
  if ('isActive' in b) data.isActive = b.isActive === true || b.isActive === 'true';
  return data;
}

const nomDejaPris = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

export async function createModeleCuve(req: Request, res: Response, next: NextFunction) {
  try {
    const data = lireChamps(req.body ?? {}, false) as Prisma.ModeleCuveUncheckedCreateInput;
    const m = await prisma.modeleCuve.create({ data }).catch((e) => {
      if (nomDejaPris(e)) throw new AppError(`Un modèle s'appelle déjà « ${data.nom} ».`, 409);
      throw e;
    });
    await auditLog(req.user!.id, 'CREATE', 'modeles_cuve', m.id, data, req);
    res.status(201).json({ success: true, data: m });
  } catch (err) { next(err); }
}

/**
 * Modifie un modèle. Une capacité changée est reportée sur TOUS ses sites, dans
 * la même transaction : la capacité d'un site rattaché est celle de son modèle.
 */
export async function updateModeleCuve(req: Request, res: Response, next: NextFunction) {
  try {
    const avant = await prisma.modeleCuve.findUnique({ where: { id: req.params.id }, select: { id: true, capaciteLitres: true } });
    if (!avant) throw new AppError('Modèle de cuve introuvable', 404);
    const data = lireChamps(req.body ?? {}, true);
    if (Object.keys(data).length === 0) throw new AppError('Aucun champ à modifier.', 400);

    const capacite = data.capaciteLitres as number | undefined;
    const reporter = capacite != null && capacite !== Number(avant.capaciteLitres);
    const [m, sites] = await prisma.$transaction([
      prisma.modeleCuve.update({ where: { id: avant.id }, data }),
      ...(reporter
        ? [prisma.site.updateMany({ where: { modeleCuveId: avant.id }, data: { cuveVolumeLitres: capacite } })]
        : []),
    ]).catch((e) => {
      if (nomDejaPris(e)) throw new AppError(`Un modèle s'appelle déjà « ${data.nom} ».`, 409);
      throw e;
    });
    const sitesMisAJour = reporter ? (sites as Prisma.BatchPayload).count : 0;
    await auditLog(req.user!.id, 'UPDATE', 'modeles_cuve', avant.id, { after: data, sitesCapaciteReportee: sitesMisAJour }, req);
    res.json({ success: true, data: { ...m, sitesMisAJour } });
  } catch (err) { next(err); }
}

/** Remplace le barème d'un modèle (remplacement complet, comme celui d'un site). */
export async function replaceBaremeModele(req: Request, res: Response, next: NextFunction) {
  try {
    const m = await prisma.modeleCuve.findUnique({ where: { id: req.params.id }, select: { id: true, _count: { select: { sites: true } } } });
    if (!m) throw new AppError('Modèle de cuve introuvable', 404);
    const points = validerPointsBareme((req.body as { points?: unknown })?.points);
    await prisma.$transaction([
      prisma.baremageModeleCuve.deleteMany({ where: { modeleId: m.id } }),
      ...(points.length
        ? [prisma.baremageModeleCuve.createMany({ data: points.map((p) => ({ ...p, modeleId: m.id })) })]
        : []),
    ]);
    await auditLog(req.user!.id, 'UPDATE', 'modeles_cuve', m.id, { baremage: `${points.length} point(s)`, sitesConcernes: m._count.sites }, req);
    res.json({ success: true, data: { points: points.length, sitesConcernes: m._count.sites } });
  } catch (err) { next(err); }
}

/** Supprime un modèle que plus aucun site ne porte (sinon : le désactiver). */
export async function deleteModeleCuve(req: Request, res: Response, next: NextFunction) {
  try {
    const m = await prisma.modeleCuve.findUnique({ where: { id: req.params.id }, select: { id: true, nom: true, _count: { select: { sites: true } } } });
    if (!m) throw new AppError('Modèle de cuve introuvable', 404);
    if (m._count.sites > 0) {
      throw new AppError(`« ${m.nom} » équipe ${m._count.sites} site(s) : détachez-les d'abord, ou désactivez le modèle.`, 409);
    }
    await prisma.modeleCuve.delete({ where: { id: m.id } });
    await auditLog(req.user!.id, 'DELETE', 'modeles_cuve', m.id, { nom: m.nom }, req);
    res.json({ success: true });
  } catch (err) { next(err); }
}

/**
 * Sites à qui l'on peut attribuer un modèle : ceux du périmètre carburant (un
 * GE ou une cuve), plus ceux qui portent déjà un modèle. Avec, pour chacun,
 * d'où vient AUJOURD'HUI sa conversion - de quoi repérer d'un coup les sites
 * de 5 000 L encore « non calculables ».
 */
export async function listSitesPourModeles(_req: Request, res: Response, next: NextFunction) {
  try {
    const sites = await prisma.site.findMany({
      where: { isActive: true, OR: [SITES_AVEC_CARBURANT, { modeleCuveId: { not: null } }] },
      orderBy: [{ region: 'asc' }, { nom: 'asc' }],
      select: {
        id: true, nom: true, region: true, statutGE: true, cuveVolumeLitres: true, modeleCuveId: true,
        formeCuve: true, cuveLongueurCm: true, cuveLargeurCm: true, cuveHauteurCm: true, cuveDiametreCm: true,
        baremage: { orderBy: { hauteurCm: 'asc' }, select: { hauteurCm: true, litres: true } },
      },
    });
    const modeles = await configsModeles();
    res.json({
      success: true,
      data: sites.map((s) => {
        const r = resoudreConfigCuve(configPropre(s), s.modeleCuveId ? modeles.get(s.modeleCuveId) : null);
        return {
          id: s.id,
          nom: s.nom,
          region: s.region,
          sansGE: s.statutGE === 'PAS_DE_GE',
          capaciteLitres: n(s.cuveVolumeLitres),
          modeleCuveId: s.modeleCuveId,
          source: r.source,
          pointsBaremePropre: s.baremage.length,
        };
      }),
    });
  } catch (err) { next(err); }
}

/**
 * Affectation EN MASSE : rattache des sites à un modèle (capacité alignée sur
 * la sienne), ou les détache (`modeleId: null` - la capacité reste celle du
 * site, qui n'a pas changé de cuve pour autant).
 */
export async function affecterModeleCuve(req: Request, res: Response, next: NextFunction) {
  try {
    const b = (req.body ?? {}) as { modeleId?: unknown; siteIds?: unknown };
    const ids = Array.isArray(b.siteIds) ? [...new Set(b.siteIds.map(String))] : [];
    if (ids.length === 0 || ids.length > 2000) throw new AppError('Sélectionnez entre 1 et 2000 sites.', 422);
    const modeleId = b.modeleId ? String(b.modeleId) : null;

    let data: Prisma.SiteUncheckedUpdateManyInput = { modeleCuveId: null };
    let nom: string | null = null;
    if (modeleId) {
      const m = await prisma.modeleCuve.findUnique({ where: { id: modeleId }, select: { nom: true, isActive: true, capaciteLitres: true } });
      if (!m) throw new AppError('Modèle de cuve introuvable', 404);
      if (!m.isActive) throw new AppError(`Le modèle « ${m.nom} » est désactivé : il ne peut plus être attribué.`, 422);
      data = { modeleCuveId: modeleId, cuveVolumeLitres: m.capaciteLitres };
      nom = m.nom;
    }
    const r = await prisma.site.updateMany({ where: { id: { in: ids }, isActive: true }, data });
    await auditLog(req.user!.id, 'UPDATE', 'sites', modeleId ?? 'detachement', {
      modeleCuve: nom ?? 'aucun', sites: r.count, siteIds: ids,
    }, req);
    await cacheService.invalidate('sites:geojson*');
    res.json({ success: true, data: { sites: r.count } });
  } catch (err) { next(err); }
}
