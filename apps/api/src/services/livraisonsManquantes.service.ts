import { LivraisonLite, MouvementLite, niveauxFrontieres, ReleveStockLite, SerieCarburant } from './stocksMensuels.service';

/**
 * LIVRAISONS MANQUANTES PROBABLES : la cuve remonte entre deux niveaux mesurés
 * sans livraison ni transfert enregistré. Calcul pur, AUCUNE donnée modifiée et
 * aucun effet sur la conso publiée : on signale, on n'invente pas de livraison.
 *
 * Mesuré en production (août à octobre 2026) : 14 % des visites, mais les deux
 * tiers de l'erreur totale sur les stocks.
 *
 *  - Le mois retenu est celui de la jauge qui RÉVÈLE la hausse : la frontière
 *    précédente prolonge le rythme d'avant (RUPTURE), c'est donc la conso de ce
 *    mois-là qui est sous-estimée, même si le gasoil est arrivé plus tôt.
 *  - Une livraison saisie à un jour près de la jauge n'est pas manquante.
 *  - Une hausse qui retombe aussitôt, ou qui suit une chute inexpliquée, est
 *    plus vraisemblablement une jauge mal saisie (SAISIE).
 */
export type StatutHausse = 'PROBABLE' | 'A_CONFIRMER' | 'SAISIE';

export interface HausseSansLivraison {
  /** Dernière jauge avant la hausse / jauge qui la révèle : la livraison est entre les deux. */
  depuis: Date;
  date: Date;
  /** Hausse mesurée + conso de l'intervalle au rythme habituel du site. */
  litres: number;
  statut: StatutHausse;
}

const JOUR_MS = 86_400_000;
/** En dessous, c'est le bruit d'une mesure de cuve. */
export const HAUSSE_MIN_L = 100;
/** Part de la hausse annulée avant ou après : au-delà, jauge douteuse / hausse incertaine. */
const PART_SAISIE = 0.6;
const PART_INCERTAINE = 0.3;
/** Un rythme mesuré sur moins de jours ne veut rien dire. */
const INTERVALLE_RYTHME_J = 3;

export function haussesSansLivraison(serie: SerieCarburant | undefined): HausseSansLivraison[] {
  if (!serie) return [];
  const { livraisons, mouvements } = serie;
  const points = niveauxFrontieres(serie.releves, serie.jauges);
  const rythme = rythmeHabituel(points, livraisons, mouvements);
  const jours = (a: ReleveStockLite, b: ReleveStockLite) => (b.date.getTime() - a.date.getTime()) / JOUR_MS;
  /** Ce qui est entré sans être enregistré entre deux niveaux (négatif = consommé). */
  const entree = (a: ReleveStockLite, b: ReleveStockLite) => -consoEntre(a, b, livraisons, mouvements);
  /** Écart au niveau attendu, conso habituelle comprise. */
  const ecart = (a: ReleveStockLite, b: ReleveStockLite) => entree(a, b) + rythme * jours(a, b);

  const out: HausseSansLivraison[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (entree(a, b) < HAUSSE_MIN_L) continue;
    if (livraisonDecalee(points, livraisons, i, entree)) continue;

    const litres = ecart(a, b);
    // Une même visite saisit souvent la même jauge sur plusieurs tâches : seule
    // une autre visite (plus de 24 h) confirme ou dément un niveau.
    const suivante = points.find((r) => r.date.getTime() > b.date.getTime() + JOUR_MS);
    const precedente = [...points].reverse().find((r) => r.date.getTime() < a.date.getTime() - JOUR_MS);
    const retombe = suivante ? -ecart(b, suivante) / litres : null;
    const chuteAvant = precedente ? -ecart(precedente, a) / litres : 0;

    const statut: StatutHausse = chuteAvant >= PART_SAISIE || (retombe != null && retombe >= PART_SAISIE) ? 'SAISIE'
      : retombe == null || retombe >= PART_INCERTAINE ? 'A_CONFIRMER'
        : 'PROBABLE';
    out.push({ depuis: a.date, date: b.date, litres: Math.round(litres), statut });
  }
  return out;
}

/** Hausses révélées pendant un mois calendaire. */
export function haussesDuMois(serie: SerieCarburant | undefined, annee: number, mois: number): HausseSansLivraison[] {
  const premier = new Date(Date.UTC(annee, mois - 1, 1));
  const suivant = new Date(Date.UTC(annee, mois, 1));
  return haussesSansLivraison(serie).filter((h) => h.date >= premier && h.date < suivant);
}

/** Litres à publier : les jauges douteuses ne sont pas une livraison. */
export function litresManquants(hausses: HausseSansLivraison[], statut?: StatutHausse): number {
  return hausses.reduce((s, h) => (h.statut !== 'SAISIE' && (!statut || h.statut === statut) ? s + h.litres : s), 0);
}

function consoEntre(a: ReleveStockLite, b: ReleveStockLite, livraisons: LivraisonLite[], mouvements: MouvementLite[]): number {
  let flux = 0;
  for (const e of livraisons) if (e.date > a.date && e.date <= b.date) flux += e.litres;
  for (const e of mouvements) if (e.date > a.date && e.date <= b.date) flux += e.litres;
  return a.volume! + flux - b.volume!;
}

/**
 * Médiane BASSE des rythmes mesurés sur les intervalles sains, 0 si aucun. Basse,
 * car une jauge trop haute crée juste après une chute qui gonfle la moyenne de
 * deux valeurs, et ferait passer l'erreur pour une livraison.
 */
function rythmeHabituel(points: ReleveStockLite[], livraisons: LivraisonLite[], mouvements: MouvementLite[]): number {
  const rythmes: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const j = (points[i].date.getTime() - points[i - 1].date.getTime()) / JOUR_MS;
    const conso = consoEntre(points[i - 1], points[i], livraisons, mouvements);
    if (j >= INTERVALLE_RYTHME_J && conso >= 0) rythmes.push(conso / j);
  }
  if (!rythmes.length) return 0;
  rythmes.sort((x, y) => x - y);
  return rythmes[Math.floor((rythmes.length - 1) / 2)];
}

/**
 * Livraison enregistrée à moins de 24 h de l'intervalle (heure de saisie, jauge
 * prise juste après le camion) : on juge alors la hausse sur l'intervalle élargi
 * qui la contient. La comparer à la livraison seule effacerait une vraie hausse
 * dès qu'une autre livraison suit de près.
 */
function livraisonDecalee(
  points: ReleveStockLite[],
  livraisons: LivraisonLite[],
  i: number,
  entree: (a: ReleveStockLite, b: ReleveStockLite) => number,
): boolean {
  const a = points[i - 1];
  const b = points[i];
  for (const l of livraisons) {
    const t = l.date.getTime();
    if (t > b.date.getTime() && t - b.date.getTime() <= JOUR_MS) {
      const apres = points.find((r) => r.date >= l.date);
      const reste = apres ? entree(a, apres) : entree(a, b) - l.litres;
      if (reste < HAUSSE_MIN_L) return true;
    }
    if (t <= a.date.getTime() && a.date.getTime() - t <= JOUR_MS) {
      const avant = [...points].reverse().find((r) => r.date < l.date);
      const reste = avant ? entree(avant, b) : entree(a, b) - l.litres;
      if (reste < HAUSSE_MIN_L) return true;
    }
  }
  return false;
}
