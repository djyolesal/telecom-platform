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
  // Disponibilité passive (coupures classées PASSIF sur les sites de ses lots) :
  // la responsabilité énergie/environnement du prestataire O&M.
  nbSites: number;
  downtimePassifHeures: number;
  dispoPassivePct: number;        // % à une décimale
  // Synthèse
  scoreSla: number;               // 0-100 (moyenne préventif + résolution + dispo passive)
  penaliteFCFA: number;
  conforme: boolean;              // respecte tous les seuils
}

export interface SlaReport {
  periodeJours: number;
  seuils: { delaiResolutionMaxH: number; tauxPreventifMinPct: number; dispoPassiveMinPct: number };
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
  const dispoMin = getNum('sla.dispoPassiveMinPct', 99);
  const penaliteDispo = getNum('sla.penaliteDispoDixiemeFCFA', 50000);

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

  type Acc = { nom: string; prevPlan: number; prevTemps: number; incResolus: number; incHorsDelai: number; sommeDelaiMin: number; nbSites: number; downtimePassifMin: number };
  const acc = new Map<string, Acc>();
  const ensure = (id: string, nom: string) => acc.get(id) ?? acc.set(id, { nom, prevPlan: 0, prevTemps: 0, incResolus: 0, incHorsDelai: 0, sommeDelaiMin: 0, nbSites: 0, downtimePassifMin: 0 }).get(id)!;

  // Tout prestataire passif entre dans l'évaluation, même sans activité sur la
  // période (dispo 100 %, conforme) — l'absence de données n'est pas un angle mort.
  for (const p of prestataireParSite.values()) ensure(p.id, p.nom).nbSites += 1;

  // ── Préventif : réalisé à temps si clôturé avant datePlanifiee + tolérance ──
  const prevs = await prisma.maintenance.findMany({
    where: { type: 'PREVENTIVE', datePlanifiee: { gte: since }, prestataireId: { not: null } },
    select: { prestataireId: true, prestataire: { select: { nom: true } }, statut: true, datePlanifiee: true, dateFin: true, dureeSuspendueMinutes: true },
  });
  for (const m of prevs) {
    if (!m.prestataireId) continue;
    const a = ensure(m.prestataireId, m.prestataire?.nom ?? '—');
    a.prevPlan += 1;
    const limite = new Date(m.datePlanifiee.getTime() + toleranceJours * 86400000);
    // Le temps SUSPENDU (urgence ordonnée ailleurs) ne compte pas contre le
    // prestataire : on le retranche de la date de fin avant de juger « à temps ».
    const finEffective = m.dateFin ? new Date(m.dateFin.getTime() - (m.dureeSuspendueMinutes ?? 0) * 60000) : null;
    if (m.statut === 'TERMINEE' && finEffective && finEffective <= limite) a.prevTemps += 1;
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

  // ── Disponibilité passive : downtime des coupures classées PASSIF, borné à la
  //    fenêtre, imputé au prestataire passif du site (le split actif/passif est
  //    alimenté par les alarmes énergie, le technicien et le NOC).
  const maintenant = new Date();
  const fenetreMin = Math.round((maintenant.getTime() - since.getTime()) / 60000);
  const coupuresPassives = await prisma.coupureReseau.findMany({
    where: { causeCategorie: 'PASSIF', OR: [{ dateFin: null }, { dateFin: { gte: since } }] },
    select: { siteId: true, dateDebut: true, dateFin: true },
  });
  for (const c of coupuresPassives) {
    const p = prestataireParSite.get(c.siteId);
    if (!p) continue;
    const debut = c.dateDebut < since ? since : c.dateDebut;
    const fin = c.dateFin ?? maintenant;
    if (fin <= since) continue;
    ensure(p.id, p.nom).downtimePassifMin += Math.max(0, Math.round((fin.getTime() - debut.getTime()) / 60000));
  }

  const parPrestataire: SlaPrestataire[] = [...acc.entries()].map(([id, a]) => {
    const tauxPreventif = a.prevPlan ? Math.round((a.prevTemps / a.prevPlan) * 100) : 100;
    const tauxResolution = a.incResolus ? Math.round(((a.incResolus - a.incHorsDelai) / a.incResolus) * 100) : 100;
    const dispoPassivePct = a.nbSites > 0
      ? Math.max(0, Math.round((1 - a.downtimePassifMin / (fenetreMin * a.nbSites)) * 1000) / 10)
      : 100;
    // Pénalité de disponibilité : par dixième de point sous l'engagement.
    const dixiemesManquants = Math.max(0, Math.round((dispoMin - dispoPassivePct) * 10));
    const scoreDispo = Math.min(100, Math.round((dispoPassivePct / dispoMin) * 100));
    const scoreSla = Math.round((tauxPreventif + tauxResolution + scoreDispo) / 3);
    const penalite =
      a.incHorsDelai * penaliteResolution +
      Math.max(0, tauxMin - tauxPreventif) * penalitePreventif +
      dixiemesManquants * penaliteDispo;
    return {
      prestataireId: id,
      prestataireNom: a.nom,
      preventivesPlanifiees: a.prevPlan,
      preventivesATemps: a.prevTemps,
      tauxPreventif,
      incidentsResolus: a.incResolus,
      incidentsHorsDelai: a.incHorsDelai,
      delaiResolutionMoyenH: a.incResolus ? Math.round((a.sommeDelaiMin / a.incResolus / 60) * 10) / 10 : null,
      nbSites: a.nbSites,
      downtimePassifHeures: Math.round(a.downtimePassifMin / 60),
      dispoPassivePct,
      scoreSla,
      penaliteFCFA: Math.round(penalite),
      conforme: tauxPreventif >= tauxMin && a.incHorsDelai === 0 && dispoPassivePct >= dispoMin,
    };
  }).sort((x, y) => y.penaliteFCFA - x.penaliteFCFA || x.scoreSla - y.scoreSla);

  return {
    periodeJours: jours,
    seuils: { delaiResolutionMaxH: delaiMaxH, tauxPreventifMinPct: tauxMin, dispoPassiveMinPct: dispoMin },
    parPrestataire,
    penaliteTotaleFCFA: parPrestataire.reduce((s, p) => s + p.penaliteFCFA, 0),
  };
}
