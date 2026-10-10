/**
 * INACCESSIBILITÉ D'UN SITE : quand une tâche due et non réalisée est-elle
 * JUSTIFIÉE ?
 *
 * Décision de l'exploitant (10/10/2026) : les tâches restent DUES pendant une
 * période d'inaccessibilité (elles comptent dans le dû et dans le taux), mais
 * une tâche non réalisée sur un mois où le site était inaccessible n'est ni un
 * retard ni une pénalité : elle est JUSTIFIÉE et montrée à part.
 *
 * Seuil : au moins N jours d'inaccessibilité dans le mois (paramètre
 * maintenance.joursInaccessibiliteJustifiant, 7 par défaut). Une coupure d'une
 * journée n'excuse pas une visite mensuelle - les autres jours suffisaient.
 */

export interface PeriodeInaccessibilite { debut: Date; fin: Date | null }

const JOUR = 86_400_000;

/** Jours CIVILS du mois [debutMois, finMois[ couverts par les périodes (sans double compte). */
export function joursInaccessibles(periodes: PeriodeInaccessibilite[], debutMois: Date, finMois: Date): number {
  const jours = new Set<number>();
  for (const p of periodes) {
    // Dates en jour civil UTC ; fin INCLUSE (le site est inaccessible ce jour-là).
    const d = Math.max(p.debut.getTime(), debutMois.getTime());
    const f = Math.min(p.fin ? p.fin.getTime() + JOUR : Infinity, finMois.getTime());
    for (let t = Math.floor(d / JOUR) * JOUR; t < f; t += JOUR) jours.add(t);
  }
  return jours.size;
}

export function moisJustifie(
  periodes: PeriodeInaccessibilite[], debutMois: Date, finMois: Date, seuilJours: number,
): boolean {
  if (!periodes.length) return false;
  const joursDuMois = Math.round((finMois.getTime() - debutMois.getTime()) / JOUR);
  return joursInaccessibles(periodes, debutMois, finMois) >= Math.min(Math.max(1, seuilJours), joursDuMois);
}
