import { AppError } from './AppError';

/** Garde-fou, pas une règle métier : un montant au-delà est une faute de frappe. */
export const COUT_TACHE_MAX = 1_000_000_000;

/**
 * Valide le prix saisi pour une tâche préventive (FCFA, par exécution et par
 * site).
 *
 * Renvoie `null` pour « pas de prix » (champ vidé) et un nombre, arrondi au
 * centime, sinon. Le zéro est un prix valide - prestation incluse - et NE se
 * confond PAS avec l'absence de prix : c'est toute la raison d'être de ce
 * retour à trois états. Une facture doit pouvoir distinguer « gratuit » de
 * « prix non renseigné ».
 */
export function normaliserCout(brut: unknown): number | null {
  if (brut === null || brut === undefined) return null;
  let n: number;
  if (typeof brut === 'number') {
    n = brut;
  } else if (typeof brut === 'string') {
    // Saisie à la française : « 1 500,50 », avec espaces (dont insécables).
    const net = brut.replace(/[\s  ]/g, '').replace(',', '.');
    if (net === '') return null;
    // Number('') vaut 0 et Number('12abc') vaut NaN : on refuse tout ce qui
    // n'est pas un nombre décimal plein, plutôt que de laisser passer « 0 ».
    if (!/^\d+(\.\d+)?$/.test(net) && !/^-/.test(net)) {
      throw new AppError('Coût invalide : un montant en FCFA est attendu.', 422);
    }
    n = Number(net);
  } else {
    throw new AppError('Coût invalide : un montant en FCFA est attendu.', 422);
  }
  if (!Number.isFinite(n)) throw new AppError('Coût invalide : un montant en FCFA est attendu.', 422);
  if (n < 0) throw new AppError('Le coût ne peut pas être négatif.', 422);
  if (n > COUT_TACHE_MAX) throw new AppError(`Coût trop élevé (maximum ${COUT_TACHE_MAX.toLocaleString('fr-FR')} FCFA).`, 422);
  return Math.round(n * 100) / 100;
}
