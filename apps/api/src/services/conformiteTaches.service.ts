import { prisma } from '../config/database';
import { addMonths } from 'date-fns';
import { CONTRACTUAL_TASKS, FREQUENCE_MOIS, exigePremiereManuelle, SiteEligibilite, TachePreventive } from '../utils/tachesPreventives';
import { sourcesForConfig } from '../utils/energy';
import { dateReferenceTaches } from './settings.service';

/**
 * MOTEUR DU DÛ CONTRACTUEL, partagé entre le rapport de conformité et le
 * récap journalier (une seule implémentation des règles - l'audit du 11/09 a
 * montré ce que coûtent les copies qui divergent) :
 *
 *  - une tâche est DUE sur un mois si sa dernière exécution VALIDE (TERMINEE,
 *    non invalidée) + fréquence tombe avant la fin du mois ;
 *  - trimestrielles/semestrielles jamais exécutées : première planification
 *    MANUELLE, aucun dû automatique tant que le cycle n'est pas amorcé ;
 *  - mensuelles jamais enregistrées : réputées faites à la date de référence
 *    du suivi (taches.dateReferenceJamaisFaites) si elle est posée ;
 *  - tâche « suivi par les données » (dépotage) : due chaque mois, réalisée
 *    si relevé complet (GE avec carburant + CEET selon la config) OU un
 *    dépotage dans le mois ;
 *  - le contrat SOLAIRE est hors périmètre (rapport dédié).
 */

export interface SiteDuContrat {
  id: string;
  powerConfig: string;
  typePylone: string | null;
  hasClimatiseur: boolean;
  hasExtincteurs: boolean;
  statutGE: string;
  cuveVolumeLitres: unknown;
}

export type StatutTacheMois = 'OK' | 'NOK' | 'NA';

export interface DuSite {
  /** dues/réalisées par mois demandé (clé 'AAAA-MM'). */
  parMois: Map<string, { dues: number; realisees: number }>;
  /** État par tâche du catalogue pour le MOIS CIBLE. */
  statuts: Record<string, StatutTacheMois>;
  /** Aucune tâche NOK sur le mois cible (le « avec dû » reste au consommateur). */
  conforme: boolean;
}

/** Colonnes de la matrice : le catalogue passif planifiable. */
export function tachesCataloguePassif(): TachePreventive[] {
  return CONTRACTUAL_TASKS.filter((t) => t.categorie !== 'SOLAIRE' && FREQUENCE_MOIS[t.frequence] != null);
}

const cleMois = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/**
 * Calcule le dû par site pour chacun des mois demandés (clés 'AAAA-MM',
 * ordonnés), le mois CIBLE étant celui dont on veut l'état par tâche.
 */
export async function calculerDuParSite(
  sites: SiteDuContrat[],
  moisListe: string[],
  moisCible: string,
): Promise<Map<string, DuSite>> {
  const resultat = new Map<string, DuSite>();
  if (!sites.length || !moisListe.length) return resultat;

  const bornes = moisListe.map((mois) => {
    const [a, m] = mois.split('-').map(Number);
    return { mois, debut: new Date(Date.UTC(a, m - 1, 1)), fin: new Date(Date.UTC(a, m, 1)) };
  });
  const since = bornes[0].debut;
  const finFenetre = bornes[bornes.length - 1].fin;
  const idsSites = sites.map((x) => x.id);

  // Exécutions VALIDES : la fenêtre en détail + la DERNIÈRE antérieure par
  // (site, tâche) - seule elle compte pour la dueness (historique borné).
  const [execsFenetre, dernieresAvant, depotagesFenetre, relevesFenetre] = await Promise.all([
    prisma.maintenance.findMany({
      where: {
        statut: 'TERMINEE', invalideeLe: null, tachePreventiveKey: { not: null },
        siteId: { in: idsSites }, dateFin: { gte: since, lt: finFenetre },
      },
      select: { siteId: true, tachePreventiveKey: true, dateFin: true },
    }),
    prisma.maintenance.groupBy({
      by: ['siteId', 'tachePreventiveKey'],
      where: {
        statut: 'TERMINEE', invalideeLe: null, tachePreventiveKey: { not: null },
        siteId: { in: idsSites }, dateFin: { lt: since, not: null },
      },
      _max: { dateFin: true },
    }),
    prisma.depotage.findMany({
      where: { siteId: { in: idsSites }, dateDepotage: { gte: since, lt: finFenetre } },
      select: { siteId: true, dateDepotage: true },
    }),
    prisma.releveEnergie.findMany({
      where: { siteId: { in: idsSites }, dateReleve: { gte: since, lt: finFenetre }, source: { in: ['GE', 'CEET'] } },
      select: { siteId: true, dateReleve: true, source: true, volumeGasoilLitres: true },
    }),
  ]);

  const execsParCle = new Map<string, Date[]>();
  for (const g of dernieresAvant) {
    if (g._max.dateFin) execsParCle.set(`${g.siteId}:${g.tachePreventiveKey}`, [g._max.dateFin]);
  }
  for (const x of execsFenetre) {
    const k = `${x.siteId}:${x.tachePreventiveKey}`;
    (execsParCle.get(k) ?? execsParCle.set(k, []).get(k)!).push(x.dateFin!);
  }
  for (const l of execsParCle.values()) l.sort((x, y) => x.getTime() - y.getTime());

  // Jetons de suivi (tâche dépotage) : 'LIV', 'GE' (avec carburant), 'CEET'.
  const suiviParCle = new Map<string, Set<string>>();
  const jeton = (siteId: string, d: Date, tok: string) => {
    const k = `${siteId}:${cleMois(d)}`;
    (suiviParCle.get(k) ?? suiviParCle.set(k, new Set()).get(k)!).add(tok);
  };
  for (const d of depotagesFenetre) jeton(d.siteId, d.dateDepotage, 'LIV');
  for (const r of relevesFenetre) {
    if (r.source === 'GE') { if (r.volumeGasoilLitres != null) jeton(r.siteId, r.dateReleve, 'GE'); }
    else jeton(r.siteId, r.dateReleve, 'CEET');
  }
  const suiviOk = (site: SiteDuContrat, mois: string): boolean => {
    const vus = suiviParCle.get(`${site.id}:${mois}`);
    if (!vus) return false;
    if (vus.has('LIV')) return true;
    const requises = sourcesForConfig(site.powerConfig).filter((x) => x === 'GE' || x === 'CEET');
    return requises.length > 0 && requises.every((x) => vus.has(x));
  };

  const catalogue = tachesCataloguePassif();
  const refTaches = dateReferenceTaches();

  for (const site of sites) {
    const parMois = new Map<string, { dues: number; realisees: number }>(bornes.map((b) => [b.mois, { dues: 0, realisees: 0 }]));
    const statuts: Record<string, StatutTacheMois> = {};
    const compter = (mois: string, realisee: boolean, t: TachePreventive) => {
      const c = parMois.get(mois)!;
      c.dues++;
      if (realisee) c.realisees++;
      if (mois === moisCible && !realisee) statuts[t.key] = 'NOK';
    };
    for (const t of catalogue) {
      if (!t.eligible(site as unknown as SiteEligibilite)) { statuts[t.key] = 'NA'; continue; }
      statuts[t.key] = 'OK'; // à jour par défaut ; NOK si un dû du mois cible n'est pas réalisé
      if (t.suiviParDonnees) {
        for (const b of bornes) compter(b.mois, suiviOk(site, b.mois), t);
        continue;
      }
      const freq = FREQUENCE_MOIS[t.frequence]!;
      const histo = execsParCle.get(`${site.id}:${t.key}`) ?? [];
      for (const b of bornes) {
        let derniereAvant: Date | null = null;
        let realisee = false;
        for (const d of histo) {
          if (d < b.debut) derniereAvant = d;
          else if (d < b.fin) realisee = true;
          else break;
        }
        // Trim./sem. jamais exécutée : première planification MANUELLE.
        if (!derniereAvant && exigePremiereManuelle(t.frequence)) continue;
        // Mensuelle jamais enregistrée : réputée faite à la date de référence
        // (<= : une référence AU 1er du mois vaut pour ce mois-là).
        if (!derniereAvant && refTaches && refTaches <= b.debut) derniereAvant = refTaches;
        const due = !derniereAvant || addMonths(derniereAvant, freq) < b.fin;
        if (due) compter(b.mois, realisee, t);
      }
    }
    resultat.set(site.id, {
      parMois,
      statuts,
      conforme: !Object.values(statuts).includes('NOK'),
    });
  }
  return resultat;
}
