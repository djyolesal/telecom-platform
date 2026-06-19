import { Request, Response, NextFunction } from 'express';
import { ScopeMaintenance } from '@prisma/client';
import { addMonths } from 'date-fns';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { auditLog } from '../services/audit.service';
import { genererPlanningPreventif } from '../services/planning.service';
import {
  CONTRACTUAL_TASKS,
  TASK_BY_KEY,
  FREQUENCE_MOIS,
  FREQUENCE_LABEL,
  tachesForSite,
  tachesPlanifiables,
  SiteEligibilite,
} from '../utils/tachesPreventives';

const SCOPES_PASSIFS: ScopeMaintenance[] = ['PASSIVE', 'LES_DEUX'];

/** Statut d'échéance d'une tâche pour un site. */
type StatutEcheance = 'JAMAIS' | 'EN_RETARD' | 'A_JOUR';

function statutEcheance(lastDone: Date | null, freqMois: number | null, now: Date): { statut: StatutEcheance; prochaine: Date | null } {
  if (freqMois == null) return { statut: lastDone ? 'A_JOUR' : 'JAMAIS', prochaine: null }; // au besoin
  if (!lastDone) return { statut: 'JAMAIS', prochaine: now };
  const prochaine = addMonths(lastDone, freqMois);
  return { statut: prochaine < now ? 'EN_RETARD' : 'A_JOUR', prochaine };
}

/** Catalogue contractuel (statique). */
export async function getCatalogue(_req: Request, res: Response) {
  res.json({
    success: true,
    data: CONTRACTUAL_TASKS.map((t) => ({
      numero: t.numero,
      key: t.key,
      libelle: t.libelle,
      categorie: t.categorie,
      frequence: t.frequence,
      frequenceLabel: FREQUENCE_LABEL[t.frequence],
      cible: t.cible,
    })),
  });
}

/** Tâches contractuelles applicables à un site + dernière exécution / prochaine échéance. */
export async function getTachesForSite(req: Request, res: Response, next: NextFunction) {
  try {
    const site = await prisma.site.findUnique({ where: { id: req.params.id } });
    if (!site) throw new AppError('Site introuvable', 404);

    const applicables = tachesForSite(site as unknown as SiteEligibilite);
    // Dernières exécutions terminées par clé de tâche pour ce site.
    const done = await prisma.maintenance.groupBy({
      by: ['tachePreventiveKey'],
      where: { siteId: site.id, statut: 'TERMINEE', tachePreventiveKey: { in: applicables.map((t) => t.key) } },
      _max: { dateFin: true },
    });
    const lastByKey = new Map(done.map((d) => [d.tachePreventiveKey, d._max.dateFin]));
    const now = new Date();

    res.json({
      success: true,
      data: applicables.map((t) => {
        const last = lastByKey.get(t.key) ?? null;
        const { statut, prochaine } = statutEcheance(last, FREQUENCE_MOIS[t.frequence], now);
        return {
          numero: t.numero,
          key: t.key,
          libelle: t.libelle,
          categorie: t.categorie,
          frequence: t.frequence,
          frequenceLabel: FREQUENCE_LABEL[t.frequence],
          derniereExecution: last,
          prochaineEcheance: prochaine,
          statut,
        };
      }),
    });
  } catch (err) { next(err); }
}

/**
 * Génère le planning préventif : crée une maintenance PLANIFIÉE pour chaque
 * couple site × tâche périodique applicable qui est dû (jamais faite, ou
 * dernière exécution + fréquence dépassée), sans doublon si un ticket est déjà ouvert.
 * Optionnel: ?horizonJours=N pour anticiper les échéances à venir.
 */
export async function genererPlanning(req: Request, res: Response, next: NextFunction) {
  try {
    const horizonJours = Math.max(0, Number(req.query.horizon_jours ?? 0) || 0);
    const result = await genererPlanningPreventif(horizonJours);
    await auditLog(req.user!.id, 'CREATE', 'maintenances', 'planning-preventif', { ...result, horizonJours }, req);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

/**
 * Échéancier de conformité préventive : pour chaque site actif × tâche applicable
 * périodique, statut (jamais / en retard / à jour). Filtres: prestataire_id, statut.
 */
export async function getEcheancier(req: Request, res: Response, next: NextFunction) {
  try {
    const { prestataire_id, statut: filtreStatut } = req.query as Record<string, string>;
    const now = new Date();

    const sites = await prisma.site.findMany({
      where: { isActive: true },
      include: { lot: { include: { assignments: { where: { scope: { in: SCOPES_PASSIFS } }, include: { prestataire: { select: { id: true, nom: true } } } } } } },
    });

    const done = await prisma.maintenance.groupBy({
      by: ['siteId', 'tachePreventiveKey'],
      where: { statut: 'TERMINEE', tachePreventiveKey: { not: null } },
      _max: { dateFin: true },
    });
    const lastByKey = new Map<string, Date>();
    for (const d of done) if (d.tachePreventiveKey && d._max.dateFin) lastByKey.set(`${d.siteId}:${d.tachePreventiveKey}`, d._max.dateFin);

    const lignes: Array<Record<string, unknown>> = [];
    let aJour = 0, enRetard = 0, jamais = 0;

    for (const site of sites) {
      const presta = site.lot?.assignments?.[0]?.prestataire ?? null;
      if (prestataire_id && presta?.id !== prestataire_id) continue;
      for (const t of tachesPlanifiables(site as unknown as SiteEligibilite)) {
        const last = lastByKey.get(`${site.id}:${t.key}`) ?? null;
        const { statut, prochaine } = statutEcheance(last, FREQUENCE_MOIS[t.frequence], now);
        if (statut === 'A_JOUR') aJour++; else if (statut === 'EN_RETARD') enRetard++; else jamais++;
        if (filtreStatut && statut !== filtreStatut) continue;
        lignes.push({
          siteId: site.id, siteCode: site.code, siteNom: site.nom, region: site.region,
          prestataire: presta?.nom ?? null, prestataireId: presta?.id ?? null,
          tache: t.libelle, key: t.key, frequence: t.frequence, frequenceLabel: FREQUENCE_LABEL[t.frequence],
          derniereExecution: last, prochaineEcheance: prochaine, statut,
        });
      }
    }

    // En retard d'abord, puis jamais, puis à jour.
    const ordre: Record<StatutEcheance, number> = { EN_RETARD: 0, JAMAIS: 1, A_JOUR: 2 };
    lignes.sort((a, b) => ordre[a.statut as StatutEcheance] - ordre[b.statut as StatutEcheance]);

    res.json({ success: true, data: { resume: { aJour, enRetard, jamais, total: aJour + enRetard + jamais }, lignes } });
  } catch (err) { next(err); }
}

export { TASK_BY_KEY };
