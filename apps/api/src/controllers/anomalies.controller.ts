import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { paginate } from '../utils/paginator';
import { auditLog } from '../services/audit.service';
import { sitePerimetre, isRestreint } from '../utils/perimetre';

/** Statuts de traitement : à vérifier, justifiée (explication reçue), à corriger. */
const STATUTS = ['A_VERIFIER', 'JUSTIFIEE', 'A_CORRIGER'] as const;

/**
 * ANOMALIES DE SAISIE : ce que les contrôles de vraisemblance ont relevé, et
 * ce que la supervision en a fait.
 *
 * L'intérêt n'est pas la ligne isolée - une valeur inhabituelle peut être
 * parfaitement légitime - mais le TRAITEMENT : chaque anomalie doit finir
 * justifiée ou corrigée, et la récurrence d'un même code sur un même site est
 * le vrai signal.
 */
export async function listerAnomalies(req: Request, res: Response, next: NextFunction) {
  try {
    const { statut, code, source, site_id, prestataire_id, mois, page = '1', limit = '30' } =
      req.query as Record<string, string>;

    const bornes: Record<string, Date> = {};
    if (/^\d{4}-\d{2}$/.test(mois ?? '')) {
      const [a, m] = mois.split('-').map(Number);
      bornes.gte = new Date(a, m - 1, 1);
      bornes.lt = new Date(a, m, 1);
    }

    const perimetre = await sitePerimetre(req.user!.id);
    const where: Record<string, unknown> = {
      ...(statut ? { statut } : {}),
      ...(code ? { code } : {}),
      ...(source ? { source } : {}),
      ...(site_id ? { siteId: site_id } : {}),
      ...(Object.keys(bornes).length ? { createdAt: bornes } : {}),
      ...(isRestreint(perimetre) || prestataire_id
        ? {
            site: {
              ...(isRestreint(perimetre) ? perimetre : {}),
              ...(prestataire_id
                ? { lot: { assignments: { some: { prestataireId: prestataire_id } } } }
                : {}),
            },
          }
        : {}),
    };

    const { data, meta } = await paginate(
      prisma.anomalieSaisie,
      {
        where,
        orderBy: { createdAt: 'desc' },
        include: { site: { select: { id: true, code: true, nom: true, region: true } } },
      },
      { page: parseInt(page), limit: parseInt(limit) },
    );

    // Le compteur « à vérifier » du MÊME filtre : sans lui, on ne sait pas si
    // la page qu'on regarde est la pointe d'une pile ou tout ce qu'il y a.
    const aVerifier = await prisma.anomalieSaisie.count({ where: { ...where, statut: 'A_VERIFIER' } });
    res.json({ success: true, data, meta: { ...meta, aVerifier } });
  } catch (err) { next(err); }
}

/** Répartition par code sur la période : c'est la RÉCURRENCE qui fait décider. */
export async function statsAnomalies(req: Request, res: Response, next: NextFunction) {
  try {
    const { mois } = req.query as Record<string, string>;
    const bornes: Record<string, Date> = {};
    if (/^\d{4}-\d{2}$/.test(mois ?? '')) {
      const [a, m] = mois.split('-').map(Number);
      bornes.gte = new Date(a, m - 1, 1);
      bornes.lt = new Date(a, m, 1);
    }
    const perimetre = await sitePerimetre(req.user!.id);
    const where = {
      ...(Object.keys(bornes).length ? { createdAt: bornes } : {}),
      ...(isRestreint(perimetre) ? { site: perimetre } : {}),
    };
    const parCode = await prisma.anomalieSaisie.groupBy({
      by: ['code', 'statut'],
      where,
      _count: { _all: true },
    });
    res.json({
      success: true,
      data: parCode.map((c) => ({ code: c.code, statut: c.statut, nombre: c._count._all })),
    });
  } catch (err) { next(err); }
}

/**
 * TRAITEMENT d'une anomalie : justifiée (avec le motif) ou à corriger.
 *
 * Le motif est EXIGÉ pour justifier : « compteur remplacé le 12/08 » vaut une
 * explication, un clic sans mot n'en est pas une - et c'est ce texte qu'on
 * relira dans six mois.
 */
export async function traiterAnomalie(req: Request, res: Response, next: NextFunction) {
  try {
    const { statut, motif } = req.body as { statut?: string; motif?: string };
    if (!STATUTS.includes(statut as typeof STATUTS[number])) {
      throw new AppError('Statut invalide (A_VERIFIER, JUSTIFIEE ou A_CORRIGER).', 422);
    }
    if (statut === 'JUSTIFIEE' && !String(motif ?? '').trim()) {
      throw new AppError('Indiquez ce qui justifie cette valeur (compteur remplacé, cuve agrandie…).', 422);
    }

    const perimetre = await sitePerimetre(req.user!.id);
    const existante = await prisma.anomalieSaisie.findFirst({
      where: { id: req.params.id, ...(isRestreint(perimetre) ? { site: perimetre } : {}) },
      select: { id: true, code: true, siteId: true },
    });
    if (!existante) throw new AppError('Anomalie introuvable.', 404);

    const anomalie = await prisma.anomalieSaisie.update({
      where: { id: existante.id },
      data: {
        statut,
        motifTraitement: String(motif ?? '').trim() || null,
        traiteePar: req.user!.id,
        traiteeLe: new Date(),
      },
      include: { site: { select: { id: true, code: true, nom: true, region: true } } },
    });
    await auditLog(req.user!.id, 'UPDATE', 'anomalies_saisie', anomalie.id,
      { statut, code: existante.code, motif: motif ?? null }, req);
    res.json({ success: true, data: anomalie });
  } catch (err) { next(err); }
}
