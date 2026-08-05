/**
 * Normalisation des clés du transport (plaque et nom de chauffeur).
 *
 * Sans elle, aucune agrégation n'est possible : l'OCR d'un bordereau produit
 * « TG 1234 AB », l'interface web suggère « TG-1234-AB » et un transporteur
 * saisit « tg1234ab » — trois camions différents pour la base, un seul sur la
 * route. Même problème pour « KOFFI Jean », « koffi  jean » et « Koffi Jean ».
 *
 * Les fonctions doivent rester PURES et alignées sur les expressions SQL du
 * backfill de la migration 0040 : toute divergence recréerait des doublons.
 */

/** Sentinelle des brouillons du réappro prédictif : ce n'est pas un camion. */
const PLAQUES_SENTINELLES = new Set(['AAFFECTER']);

/** Majuscules, tout caractère non alphanumérique retiré. Accents neutralisés. */
export function normaliserPlaque(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Une plaque exploitable comme clé de référentiel : ni vide, ni la sentinelle
 * « À AFFECTER » (qui rassemblerait tous les brouillons du parc sur un même
 * véhicule fantôme), et assez longue pour être une immatriculation.
 */
export function plaqueUtilisable(v: unknown): boolean {
  const p = normaliserPlaque(v);
  return p.length >= 4 && !PLAQUES_SENTINELLES.has(p);
}

/** Majuscules, accents neutralisés, espaces internes réduits à un seul. */
export function normaliserNom(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

/** Un nom de chauffeur exploitable : au moins deux caractères non numériques. */
export function nomUtilisable(v: unknown): boolean {
  const s = normaliserNom(v);
  return s.length >= 2 && /[A-Z]/.test(s);
}

/**
 * Deux noms désignent-ils le même chauffeur ? Comparaison sur les MOTS et non
 * sur la chaîne : « KOFFI Jean » et « Jean KOFFI » sont la même personne, et
 * l'ordre nom/prénom varie d'un document à l'autre au Togo. Un prénom d'usage
 * en plus ne doit pas non plus déclencher une fausse anomalie : on exige que
 * les mots du plus court soient tous présents dans le plus long.
 */
export function memeChauffeur(a: unknown, b: unknown): boolean {
  const na = normaliserNom(a);
  const nb = normaliserNom(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ma = na.split(' ').filter((w) => w.length > 1);
  const mb = nb.split(' ').filter((w) => w.length > 1);
  if (!ma.length || !mb.length) return false;
  const [court, long] = ma.length <= mb.length ? [ma, mb] : [mb, ma];
  return court.every((w) => long.includes(w));
}

/** Fenêtre d'alerte avant l'échéance du certificat de jaugeage. */
export const JAUGEAGE_PREAVIS_JOURS = 30;

export type StatutJaugeage = 'VALIDE' | 'EXPIRE_BIENTOT' | 'EXPIRE' | 'ABSENT';

/**
 * État du certificat de jaugeage d'une citerne à une date donnée.
 * ABSENT n'est pas assimilé à EXPIRE : un camion jamais renseigné est un trou
 * de données à combler, pas une infraction avérée — les deux ne déclenchent
 * pas le même geste (réclamer la pièce vs replanifier un jaugeage).
 */
export function statutJaugeage(expiration: Date | string | null | undefined, ref: Date = new Date()): StatutJaugeage {
  if (!expiration) return 'ABSENT';
  const exp = new Date(expiration);
  if (Number.isNaN(exp.getTime())) return 'ABSENT';
  if (exp < ref) return 'EXPIRE';
  const preavis = new Date(ref.getTime() + JAUGEAGE_PREAVIS_JOURS * 86_400_000);
  return exp <= preavis ? 'EXPIRE_BIENTOT' : 'VALIDE';
}
