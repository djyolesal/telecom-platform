import { addMonths } from 'date-fns';
import { ScopeMaintenance } from '@prisma/client';
import { genererReference } from './reference.service';
import { prisma } from '../config/database';
import { FREQUENCE_MOIS, tachesPlanifiables, SiteEligibilite } from '../utils/tachesPreventives';

const SCOPES_PASSIFS: ScopeMaintenance[] = ['PASSIVE', 'LES_DEUX'];

export interface PlanningResult {
  crees: number;
  ignoresSansPrestataire: number;
}

/**
 * Génère le planning préventif contractuel : crée une maintenance PLANIFIÉE pour
 * chaque couple site × tâche périodique applicable qui est dû (jamais faite, ou
 * dernière exécution + fréquence dépassée), attribuée au prestataire passif du lot,
 * sans doublon si un ticket est déjà ouvert.
 *
 * @param horizonJours anticipe les échéances à venir dans N jours (0 = ce qui est dû aujourd'hui).
 */
export async function genererPlanningPreventif(horizonJours = 0): Promise<PlanningResult> {
  const now = new Date();
  const limite = new Date(now.getTime() + Math.max(0, horizonJours) * 86400000);

  const sites = await prisma.site.findMany({ where: { isActive: true } });

  // Préchargement : prestataire passif par lot.
  const assignments = await prisma.lotAssignment.findMany({
    where: { scope: { in: SCOPES_PASSIFS } },
    orderBy: { scope: 'asc' },
  });
  const passifByLot = new Map<string, string>();
  for (const a of assignments) if (!passifByLot.has(a.lotId)) passifByLot.set(a.lotId, a.prestataireId);

  // Dernières exécutions terminées (site+clé).
  const done = await prisma.maintenance.groupBy({
    by: ['siteId', 'tachePreventiveKey'],
    where: { statut: 'TERMINEE', tachePreventiveKey: { not: null } },
    _max: { dateFin: true },
  });
  const lastByKey = new Map<string, Date>();
  for (const d of done) if (d.tachePreventiveKey && d._max.dateFin) lastByKey.set(`${d.siteId}:${d.tachePreventiveKey}`, d._max.dateFin);

  // Tickets déjà ouverts (PLANIFIEE/EN_COURS/SUSPENDUE) → ne pas dupliquer.
  const ouverts = await prisma.maintenance.findMany({
    where: { statut: { in: ['PLANIFIEE', 'EN_COURS', 'SUSPENDUE'] }, tachePreventiveKey: { not: null } },
    select: { siteId: true, tachePreventiveKey: true },
  });
  const ouvertSet = new Set(ouverts.map((o) => `${o.siteId}:${o.tachePreventiveKey}`));

  let crees = 0;
  let ignoresSansPrestataire = 0;
  const aCreer: { siteId: string; categorie: string; equipement: string; key: string; datePlanifiee: Date; prestataireId: string }[] = [];

  for (const site of sites) {
    const prestataireId = site.lotId ? passifByLot.get(site.lotId) : undefined;
    for (const t of tachesPlanifiables(site as unknown as SiteEligibilite)) {
      const mapKey = `${site.id}:${t.key}`;
      if (ouvertSet.has(mapKey)) continue;
      const freq = FREQUENCE_MOIS[t.frequence]!;
      const last = lastByKey.get(mapKey) ?? null;
      const prochaine = last ? addMonths(last, freq) : now;
      if (prochaine > limite) continue;
      if (!prestataireId) { ignoresSansPrestataire++; continue; }
      aCreer.push({ siteId: site.id, categorie: t.categorie, equipement: t.libelle, key: t.key, datePlanifiee: prochaine < now ? now : prochaine, prestataireId });
    }
  }

  for (const m of aCreer) {
    await prisma.maintenance.create({
      data: {
        reference: await genererReference(prisma, 'MNT', m.datePlanifiee),
        siteId: m.siteId,
        type: 'PREVENTIVE',
        categorie: m.categorie as never,
        equipement: m.equipement,
        datePlanifiee: m.datePlanifiee,
        prestataireId: m.prestataireId,
        tachePreventiveKey: m.key,
      },
    });
    crees++;
  }

  return { crees, ignoresSansPrestataire };
}
