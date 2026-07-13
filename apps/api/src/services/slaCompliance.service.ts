import { prisma } from '../config/database';
import { getNum } from './settings.service';

/**
 * Conformité SLA par prestataire : mesure le respect des engagements contractuels
 * (résolution des incidents dans les délais, respect du planning préventif) sur
 * une période, et estime les pénalités correspondantes.
 *
 * Rattachement des incidents au prestataire : via le site → lot → attribution
 * (périmètre passif, comme la résolution du prestataire d'une maintenance).
 */
export interface SlaPrestataire {
  prestataireId: string;
  prestataireNom: string;
  // Préventif
  preventivesPlanifiees: number;
  preventivesATemps: number;
  tauxPreventif: number;          // %
  // Incidents
  incidentsResolus: number;
  incidentsHorsDelai: number;
  delaiResolutionMoyenH: number | null;
  // Synthèse
  scoreSla: number;               // 0-100 (moyenne respect préventif + résolution)
  penaliteFCFA: number;
  conforme: boolean;              // respecte tous les seuils
}

export interface SlaReport {
  periodeJours: number;
  seuils: { delaiResolutionMaxH: number; tauxPreventifMinPct: number };
  parPrestataire: SlaPrestataire[];
  penaliteTotaleFCFA: number;
}

export async function computeSla(opts: { jours?: number } = {}): Promise<SlaReport> {
  const jours = opts.jours && opts.jours > 0 ? opts.jours : 90;
  const since = new Date(Date.now() - jours * 86400000);

  const delaiMaxH = getNum('sla.delaiResolutionMaxH', 24);
  const tauxMin = getNum('sla.tauxPreventifMinPct', 95);
  const toleranceJours = getNum('sla.tolerancePreventifJours', 7);
  const penaliteResolution = getNum('sla.penaliteResolutionFCFA', 50000);
  const penalitePreventif = getNum('sla.penalitePreventifFCFA', 100000);

  // site → prestataire (via lot → attribution passive/les-deux).
  const [assignments, sites] = await Promise.all([
    prisma.lotAssignment.findMany({
      where: { scope: { in: ['PASSIVE', 'LES_DEUX'] } },
      select: { lotId: true, prestataireId: true, prestataire: { select: { nom: true } } },
      orderBy: { scope: 'asc' }, // PASSIVE avant LES_DEUX
    }),
    prisma.site.findMany({ select: { id: true, lotId: true } }),
  ]);
  const prestataireParLot = new Map<string, { id: string; nom: string }>();
  for (const a of assignments) {
    if (!prestataireParLot.has(a.lotId)) prestataireParLot.set(a.lotId, { id: a.prestataireId, nom: a.prestataire.nom });
  }
  const prestataireParSite = new Map<string, { id: string; nom: string }>();
  for (const s of sites) {
    if (s.lotId && prestataireParLot.has(s.lotId)) prestataireParSite.set(s.id, prestataireParLot.get(s.lotId)!);
  }

  type Acc = { nom: string; prevPlan: number; prevTemps: number; incResolus: number; incHorsDelai: number; sommeDelaiMin: number };
  const acc = new Map<string, Acc>();
  const ensure = (id: string, nom: string) => acc.get(id) ?? acc.set(id, { nom, prevPlan: 0, prevTemps: 0, incResolus: 0, incHorsDelai: 0, sommeDelaiMin: 0 }).get(id)!;

  // ── Préventif : réalisé à temps si clôturé avant datePlanifiee + tolérance ──
  const prevs = await prisma.maintenance.findMany({
    where: { type: 'PREVENTIVE', datePlanifiee: { gte: since }, prestataireId: { not: null } },
    select: { prestataireId: true, prestataire: { select: { nom: true } }, statut: true, datePlanifiee: true, dateFin: true },
  });
  for (const m of prevs) {
    if (!m.prestataireId) continue;
    const a = ensure(m.prestataireId, m.prestataire?.nom ?? '—');
    a.prevPlan += 1;
    const limite = new Date(m.datePlanifiee.getTime() + toleranceJours * 86400000);
    if (m.statut === 'TERMINEE' && m.dateFin && m.dateFin <= limite) a.prevTemps += 1;
  }

  // ── Incidents résolus : délai de résolution vs seuil ──
  const incidents = await prisma.incident.findMany({
    where: { dateOuverture: { gte: since }, dateResolution: { not: null } },
    select: { siteId: true, dureeCoupureMinutes: true, dateOuverture: true, dateResolution: true },
  });
  for (const i of incidents) {
    const p = prestataireParSite.get(i.siteId);
    if (!p) continue;
    const a = ensure(p.id, p.nom);
    a.incResolus += 1;
    const delaiMin = i.dureeCoupureMinutes ?? Math.round((i.dateResolution!.getTime() - i.dateOuverture.getTime()) / 60000);
    a.sommeDelaiMin += delaiMin;
    if (delaiMin > delaiMaxH * 60) a.incHorsDelai += 1;
  }

  const parPrestataire: SlaPrestataire[] = [...acc.entries()].map(([id, a]) => {
    const tauxPreventif = a.prevPlan ? Math.round((a.prevTemps / a.prevPlan) * 100) : 100;
    const tauxResolution = a.incResolus ? Math.round(((a.incResolus - a.incHorsDelai) / a.incResolus) * 100) : 100;
    const scoreSla = Math.round((tauxPreventif + tauxResolution) / 2);
    const penalite =
      a.incHorsDelai * penaliteResolution +
      Math.max(0, tauxMin - tauxPreventif) * penalitePreventif;
    return {
      prestataireId: id,
      prestataireNom: a.nom,
      preventivesPlanifiees: a.prevPlan,
      preventivesATemps: a.prevTemps,
      tauxPreventif,
      incidentsResolus: a.incResolus,
      incidentsHorsDelai: a.incHorsDelai,
      delaiResolutionMoyenH: a.incResolus ? Math.round((a.sommeDelaiMin / a.incResolus / 60) * 10) / 10 : null,
      scoreSla,
      penaliteFCFA: Math.round(penalite),
      conforme: tauxPreventif >= tauxMin && a.incHorsDelai === 0,
    };
  }).sort((x, y) => y.penaliteFCFA - x.penaliteFCFA || x.scoreSla - y.scoreSla);

  return {
    periodeJours: jours,
    seuils: { delaiResolutionMaxH: delaiMaxH, tauxPreventifMinPct: tauxMin },
    parPrestataire,
    penaliteTotaleFCFA: parPrestataire.reduce((s, p) => s + p.penaliteFCFA, 0),
  };
}
