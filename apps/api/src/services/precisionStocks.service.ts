import { JaugeDepotageLite, LivraisonLite, MouvementLite, niveauxFrontieres, ReleveStockLite, rythmeAvant, SerieCarburant, stockFrontiere } from './stocksMensuels.service';

/**
 * PRÉCISION RÉELLE des stocks estimés : on cache une jauge connue, chaque
 * méthode la devine, on compare. Calcul pur, sans écriture.
 *
 *  - PROLONGER : dernier relevé connu, au rythme d'avant. C'est la situation
 *    d'un mois PROVISOIRE (aucun relevé après sa fin).
 *  - ENCADRER : entre le relevé d'avant et celui d'après (mois définitif).
 * Chacune sans puis avec les jauges des dépotages.
 *
 * Pour ne pas tricher, tout ce qui a été mesuré dans les 24 h autour de la
 * jauge cachée l'est aussi : le relevé et le dépotage d'une même visite
 * s'annonceraient l'un l'autre.
 */
export const METHODES = ['PROLONGER', 'PROLONGER_JAUGES', 'ENCADRER', 'ENCADRER_JAUGES'] as const;
export type Methode = typeof METHODES[number];

const JOUR_MS = 86_400_000;

export interface Essai {
  date: Date;
  vrai: number;
  estime: Record<Methode, number>;
  /** Jours jusqu'au relevé le plus proche, jauges de dépotage exclues / comprises. */
  distanceReleves: number;
  distanceJauges: number;
  /**
   * Faux quand la cuve remonte sans livraison enregistrée entre le relevé
   * d'avant, la jauge cachée et le relevé d'après : une livraison manque, et
   * aucune méthode ne peut la deviner.
   */
  coherent: boolean;
}

export function essaisDuSite(serie: SerieCarburant, depuis: Date, jusqua: Date): Essai[] {
  const { livraisons, mouvements } = serie;
  const jauges: JaugeDepotageLite[] = serie.jauges ?? [];
  const tous = niveauxFrontieres(serie.releves);
  const essais: Essai[] = [];

  for (const cible of tous) {
    if (cible.date < depuis || cible.date >= jusqua) continue;
    const t = cible.date;
    const loin = (d: Date) => Math.abs(d.getTime() - t.getTime()) > JOUR_MS;
    const releves = serie.releves.filter((r) => loin(r.date));
    const sans = niveauxFrontieres(releves);
    const avec = niveauxFrontieres(releves, jauges.filter((j) => loin(j.date)));
    const avant = [...sans].reverse().find((r) => r.date < t);
    const apres = sans.find((r) => r.date > t);
    if (!avant || !apres) continue; // les quatre méthodes doivent pouvoir répondre

    const prolonger = (points: ReleveStockLite[]) => {
      const connus = points.filter((r) => r.date < t);
      const dernier = connus[connus.length - 1];
      return stockFrontiere(connus, livraisons, mouvements, t, rythmeAvant(connus, livraisons, mouvements, dernier)).litres;
    };
    const encadrer = (points: ReleveStockLite[]) => stockFrontiere(points, livraisons, mouvements, t, null).litres;
    const distance = (points: ReleveStockLite[]) =>
      Math.min(...points.map((r) => Math.abs(r.date.getTime() - t.getTime()))) / JOUR_MS;

    essais.push({
      date: t,
      vrai: cible.volume!,
      estime: {
        PROLONGER: prolonger(sans), PROLONGER_JAUGES: prolonger(avec),
        ENCADRER: encadrer(sans), ENCADRER_JAUGES: encadrer(avec),
      },
      distanceReleves: distance(sans),
      distanceJauges: distance(avec),
      coherent: consoEntre(avant, cible, livraisons, mouvements) >= 0 && consoEntre(cible, apres, livraisons, mouvements) >= 0,
    });
  }
  return essais;
}

function consoEntre(a: ReleveStockLite, b: ReleveStockLite, livraisons: LivraisonLite[], mouvements: MouvementLite[]): number {
  const flux = [...livraisons, ...mouvements].reduce((s, e) => (e.date > a.date && e.date <= b.date ? s + e.litres : s), 0);
  return a.volume! + flux - b.volume!;
}

export interface Resume { n: number; mediane: number; moyenne: number; p90: number; biais: number; sous50: number }

/** Erreurs d'une méthode sur un lot d'essais. Biais > 0 : la méthode surestime. */
export function resumer(essais: Essai[], methode: Methode): Resume | null {
  if (!essais.length) return null;
  const erreurs = essais.map((e) => e.estime[methode] - e.vrai);
  const abs = erreurs.map(Math.abs).sort((a, b) => a - b);
  const somme = (v: number[]) => v.reduce((s, x) => s + x, 0);
  const rang = (p: number) => abs[Math.min(abs.length - 1, Math.floor(abs.length * p))];
  return {
    n: abs.length,
    mediane: Math.round(rang(0.5)),
    moyenne: Math.round(somme(abs) / abs.length),
    p90: Math.round(rang(0.9)),
    biais: Math.round(somme(erreurs) / erreurs.length),
    sous50: Math.round((abs.filter((x) => x <= 50).length / abs.length) * 100),
  };
}
