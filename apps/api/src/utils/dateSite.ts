import { AppError } from './AppError';

/** Les premiers sites du réseau datent de 1999 : en deçà, c'est une faute de frappe. */
export const ANNEE_MIN_MISE_EN_SERVICE = 1990;

/**
 * Date de mise en service reçue d'un formulaire ou d'un client API.
 *
 * Pourquoi ce passage obligé : le formulaire envoie « 2022-10-03 », la colonne
 * est de type DATE, et la base n'accepte qu'un horodatage COMPLET - une date
 * seule, comme une chaîne vide, y est rejetée par une erreur de validation que
 * l'utilisateur ne voit que comme « Données invalides », sans savoir quel champ
 * est en cause. Tout site portant une date devenait ainsi impossible à modifier.
 *
 * Renvoie :
 *   - `null` pour « pas de date » (champ vidé ou null) ;
 *   - une `Date` à minuit UTC, car on parle d'un JOUR, jamais d'un instant :
 *     minuit local décalerait la date d'un jour selon le fuseau du serveur.
 * Lève une 422 explicite pour tout le reste.
 */
export function dateMiseEnService(brut: unknown, maintenant: Date = new Date()): Date | null {
  if (brut === null || brut === undefined) return null;

  let an: number, mois: number, jour: number;
  if (brut instanceof Date) {
    if (Number.isNaN(brut.getTime())) throw invalide();
    an = brut.getUTCFullYear(); mois = brut.getUTCMonth() + 1; jour = brut.getUTCDate();
  } else if (typeof brut === 'string') {
    const t = brut.trim();
    if (t === '') return null;
    // « 2022-10-03 » ou « 2022-10-03T00:00:00.000Z » : on ne retient que le JOUR.
    const m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
    if (!m) throw invalide();
    an = Number(m[1]); mois = Number(m[2]); jour = Number(m[3]);
  } else {
    throw invalide();
  }

  // La plage AVANT de construire la date : `Date.UTC` lit les années 0 à 99 comme
  // 1900 à 1999, si bien que « 0022 » deviendrait 1922 et ferait croire à une
  // date réelle - ou, ici, échouerait au contrôle suivant pour une mauvaise raison.
  if (an < ANNEE_MIN_MISE_EN_SERVICE) {
    throw new AppError(`Date de mise en service invraisemblable (avant ${ANNEE_MIN_MISE_EN_SERVICE}).`, 422);
  }

  const d = new Date(Date.UTC(an, mois - 1, jour));
  // Le 31 février « roule » vers mars sans erreur : on vérifie l'aller-retour.
  if (d.getUTCFullYear() !== an || d.getUTCMonth() !== mois - 1 || d.getUTCDate() !== jour) throw invalide();

  // Un site peut être déclaré peu avant son ouverture, pas dans dix ans.
  const limite = new Date(Date.UTC(maintenant.getUTCFullYear() + 1, maintenant.getUTCMonth(), maintenant.getUTCDate()));
  if (d > limite) throw new AppError('Date de mise en service dans le futur lointain : vérifiez l\'année.', 422);
  return d;
}

const invalide = () => new AppError('Date de mise en service invalide : AAAA-MM-JJ attendu.', 422);

/** Chaîne libre d'un formulaire : vide ou blanche = absente (null), sinon nettoyée. */
export function texteOuNull(brut: unknown): string | null {
  if (brut === null || brut === undefined) return null;
  const t = String(brut).trim();
  return t === '' ? null : t;
}
