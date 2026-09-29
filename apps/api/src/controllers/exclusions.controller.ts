import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { auditLog } from '../services/audit.service';
import { TASK_BY_KEY } from '../utils/tachesPreventives';
import { tachesCataloguePassif, tachesCatalogueSolaire } from '../services/conformiteTaches.service';

/**
 * EXCLUSIONS CONTRACTUELLES : ce qui n'est PAS dû, et depuis quand.
 *
 * Une exclusion ne se supprime pas, elle se CLÔT : la fiche de validation d'un
 * mois passé doit pouvoir se relire avec le périmètre qui avait cours alors.
 * Supprimer la ligne réécrirait l'histoire - même principe que l'invalidation
 * d'une maintenance, qui conteste sans effacer.
 */

/** Jour civil, sans heure : ces bornes se comparent à des mois, pas à des instants. */
function jour(v: unknown, champ: string): Date {
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new AppError(`${champ} : date invalide (AAAA-MM-JJ attendu).`, 422);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

const CLES_VALIDES = new Set([...tachesCataloguePassif(), ...tachesCatalogueSolaire()].map((t) => t.key));

export async function listerExclusions(req: Request, res: Response, next: NextFunction) {
  try {
    const { site_id, tache_key, actives } = req.query as Record<string, string>;
    const lignes = await prisma.exclusionContractuelle.findMany({
      where: {
        ...(site_id ? { siteId: site_id } : {}),
        ...(tache_key ? { tacheKey: tache_key } : {}),
        // Par défaut on montre TOUT, y compris l'historique clos : c'est lui
        // qui explique un chiffre d'il y a trois mois.
        ...(actives === 'true' ? { finLe: null } : {}),
      },
      orderBy: [{ finLe: 'asc' }, { debutLe: 'desc' }],
      select: {
        id: true, tacheKey: true, motif: true, debutLe: true, finLe: true, createdAt: true,
        site: { select: { id: true, code: true, nom: true, region: true, typeSite: true } },
        auteur: { select: { nom: true, prenom: true } },
      },
    });
    res.json({
      success: true,
      data: lignes.map((l) => ({
        ...l,
        tacheLibelle: TASK_BY_KEY[l.tacheKey]?.libelle ?? l.tacheKey,
      })),
      meta: { total: lignes.length, actives: lignes.filter((l) => !l.finLe).length },
    });
  } catch (err) { next(err); }
}

/**
 * Pose une exclusion sur un ou PLUSIEURS sites (le cas courant : « tous les
 * centres techniques »), pour une ou plusieurs tâches.
 */
export async function creerExclusions(req: Request, res: Response, next: NextFunction) {
  try {
    const { siteIds, typeSite, tacheKeys, motif, debutLe } = req.body as {
      siteIds?: string[]; typeSite?: string; tacheKeys?: string[]; motif?: string; debutLe?: string;
    };
    if (!motif?.trim()) throw new AppError('Le motif est obligatoire : une exclusion se justifie.', 422);
    if (!Array.isArray(tacheKeys) || !tacheKeys.length) throw new AppError('Choisissez au moins une tâche.', 422);
    const inconnues = tacheKeys.filter((k) => !CLES_VALIDES.has(k));
    if (inconnues.length) throw new AppError(`Tâche inconnue au catalogue : ${inconnues.join(', ')}.`, 422);
    const debut = jour(debutLe ?? new Date().toISOString(), 'Date de début');

    // Sélection : soit une liste explicite, soit TOUTE une nature de site.
    const cibles = typeSite
      ? await prisma.site.findMany({ where: { typeSite, isActive: true }, select: { id: true } })
      : (Array.isArray(siteIds) ? siteIds.map((id) => ({ id })) : []);
    if (!cibles.length) throw new AppError('Aucun site sélectionné.', 422);

    // Les exclusions DÉJÀ ouvertes ne sont pas redoublées : reposer la même
    // exclusion ne doit ni échouer ni créer un doublon que personne ne saurait
    // départager (un index unique partiel l'interdit d'ailleurs en base).
    const existantes = await prisma.exclusionContractuelle.findMany({
      where: { siteId: { in: cibles.map((c) => c.id) }, tacheKey: { in: tacheKeys }, finLe: null },
      select: { siteId: true, tacheKey: true },
    });
    const deja = new Set(existantes.map((e) => `${e.siteId}:${e.tacheKey}`));

    const aCreer = cibles.flatMap((c) =>
      tacheKeys.filter((k) => !deja.has(`${c.id}:${k}`)).map((k) => ({
        siteId: c.id, tacheKey: k, motif: motif.trim().slice(0, 300), debutLe: debut, creePar: req.user!.id,
      }))
    );
    if (aCreer.length) await prisma.exclusionContractuelle.createMany({ data: aCreer });

    await auditLog(req.user!.id, 'CREATE', 'exclusions_contractuelles', undefined, {
      sites: cibles.length, typeSite: typeSite ?? null, taches: tacheKeys, creees: aCreer.length, deja: deja.size, debutLe: debut,
    }, req);
    res.status(201).json({ success: true, data: { creees: aCreer.length, dejaEnVigueur: deja.size, sites: cibles.length } });
  } catch (err) { next(err); }
}

/** Lève une exclusion : elle est CLÔTURÉE à une date, jamais supprimée. */
export async function cloturerExclusion(req: Request, res: Response, next: NextFunction) {
  try {
    const { finLe } = req.body as { finLe?: string };
    const existante = await prisma.exclusionContractuelle.findUnique({
      where: { id: req.params.id },
      select: { id: true, debutLe: true, finLe: true, siteId: true, tacheKey: true },
    });
    if (!existante) throw new AppError('Exclusion introuvable', 404);
    if (existante.finLe) throw new AppError('Cette exclusion est déjà levée.', 409);
    const fin = jour(finLe ?? new Date().toISOString(), 'Date de fin');
    if (fin < existante.debutLe) throw new AppError('La date de levée doit suivre la date de prise d\'effet.', 422);

    await prisma.exclusionContractuelle.update({ where: { id: existante.id }, data: { finLe: fin } });
    await auditLog(req.user!.id, 'UPDATE', 'exclusions_contractuelles', existante.id, {
      action: 'levee', siteId: existante.siteId, tacheKey: existante.tacheKey, finLe: fin,
    }, req);
    res.json({ success: true });
  } catch (err) { next(err); }
}

/**
 * COHÉRENCE : les sites d'une nature donnée qui n'ont PAS l'exclusion attendue.
 *
 * C'est la seule raison d'être du champ `type_site` côté contrôle. Un centre
 * technique créé dans six mois, sans exclusion, ressortirait « en retard » tous
 * les mois sur un travail qu'il ne doit pas - et personne ne s'en apercevrait.
 */
export async function coherenceExclusions(req: Request, res: Response, next: NextFunction) {
  try {
    const { typeSite, tacheKeys } = req.query as Record<string, string>;
    if (!typeSite) throw new AppError('Précisez la nature de site à contrôler.', 422);
    const cles = String(tacheKeys ?? '').split(',').map((k) => k.trim()).filter(Boolean);
    if (!cles.length) throw new AppError('Précisez les tâches attendues hors contrat.', 422);

    const sites = await prisma.site.findMany({
      where: { typeSite, isActive: true },
      select: { id: true, code: true, nom: true, region: true,
        exclusions: { where: { finLe: null, tacheKey: { in: cles } }, select: { tacheKey: true } } },
      orderBy: { code: 'asc' },
    });
    const manquants = sites
      .map((s) => ({
        siteId: s.id, code: s.code, nom: s.nom, region: s.region,
        manquantes: cles.filter((k) => !s.exclusions.some((e) => e.tacheKey === k)),
      }))
      .filter((s) => s.manquantes.length);

    res.json({ success: true, data: manquants, meta: { sites: sites.length, aCorriger: manquants.length } });
  } catch (err) { next(err); }
}

/** Catalogue des tâches exclusibles, pour alimenter l'écran. */
export async function cataloguesTaches(_req: Request, res: Response, next: NextFunction) {
  try {
    const rendre = (t: { key: string; libelle: string; frequence: string; categorie: string }) =>
      ({ key: t.key, libelle: t.libelle, frequence: t.frequence, categorie: t.categorie });
    res.json({
      success: true,
      data: {
        passif: tachesCataloguePassif().map(rendre),
        solaire: tachesCatalogueSolaire().map(rendre),
      },
    });
  } catch (err) { next(err); }
}
