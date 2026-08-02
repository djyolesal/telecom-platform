/**
 * Dates fournies par le client (rejeu offline mobile, imports) : bornées à
 * [maintenant − 2 ans, maintenant + tolérance].
 *
 * Sans borne, une horloge de téléphone déréglée (ou une frappe « 2027 »)
 * insérait un relevé au FUTUR : ce relevé devenait définitivement le dernier
 * connu du site (tri par date décroissante), gelant tous les calculs de
 * consommation et de vraisemblance qui suivaient.
 */
const TOLERANCE_FUTUR_MS = 15 * 60_000; // 15 min de dérive d'horloge admise
const ANCIENNETE_MAX_MS = 2 * 365 * 24 * 3600_000;

export function dateBornee(valeur: unknown, defaut: Date = new Date()): Date {
  if (valeur == null || valeur === '') return defaut;
  const d = new Date(String(valeur));
  if (!Number.isFinite(d.getTime())) return defaut;
  const maintenant = Date.now();
  if (d.getTime() > maintenant + TOLERANCE_FUTUR_MS) return new Date(maintenant);
  if (d.getTime() < maintenant - ANCIENNETE_MAX_MS) return new Date(maintenant - ANCIENNETE_MAX_MS);
  return d;
}
