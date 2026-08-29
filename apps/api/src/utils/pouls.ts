/**
 * Ligne de vie : découpage horaire des dernières 24 h.
 * Fonctions pures (testées) — le contrôleur ne fait que compter dedans.
 */

/** Les 24 débuts d'heure couvrant les dernières 24 h, du plus ancien au plus
 *  récent (le dernier seau est l'heure EN COURS, tronquée à l'heure pile). */
export function bucketsHoraires(now: Date): Date[] {
  const courant = new Date(now);
  courant.setMinutes(0, 0, 0);
  const buckets: Date[] = [];
  for (let i = 23; i >= 0; i--) {
    buckets.push(new Date(courant.getTime() - i * 3_600_000));
  }
  return buckets;
}

/** Compte les dates par seau horaire. Une date hors fenêtre est ignorée
 *  (l'appelant filtre déjà en base ; ceinture et bretelles). */
export function compterParHeure(dates: Date[], buckets: Date[]): number[] {
  const counts = new Array<number>(buckets.length).fill(0);
  const debut = buckets[0].getTime();
  for (const d of dates) {
    const t = d.getTime();
    if (t < debut) continue;
    const idx = Math.floor((t - debut) / 3_600_000);
    if (idx >= 0 && idx < counts.length) counts[idx]++;
  }
  return counts;
}

export type Agitation = 'CALME' | 'ACTIF' | 'CRITIQUE';

/** Niveau d'agitation du parc : CRITIQUE dès qu'un site entier est down ou
 *  qu'un incident critique court ; ACTIF s'il se passe quelque chose ; CALME sinon. */
export function niveauAgitation(args: {
  coupuresSiteEntierEnCours: number;
  incidentsCritiquesEnCours: number;
  coupuresEnCours: number;
  incidentsEnCours: number;
}): Agitation {
  if (args.coupuresSiteEntierEnCours > 0 || args.incidentsCritiquesEnCours > 0) return 'CRITIQUE';
  if (args.coupuresEnCours > 0 || args.incidentsEnCours > 0) return 'ACTIF';
  return 'CALME';
}
