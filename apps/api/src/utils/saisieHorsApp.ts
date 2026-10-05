import { AppError } from './AppError';

/**
 * Validation d'un relevé pris hors application et saisi par un administrateur.
 *
 * À la différence de la saisie mobile (`bounded`, `dateBornee`), qui CORRIGE en
 * silence - une valeur aberrante devient `null`, une date lointaine est ramenée
 * à la borne - ici on REFUSE, avec le nom du champ. Un administrateur qui
 * recopie une fiche papier doit savoir qu'un « 12 5OO » n'a pas été enregistré,
 * pas découvrir plus tard qu'il l'a été sous une autre forme, ou pas du tout.
 */

const MAX = {
  indexCompteur: 1e8,      // colonne DECIMAL(10,2)
  indexHeuresGE: 1e9,      // colonne DECIMAL(10,1)
  volumeGasoilLitres: 1e6, // colonne DECIMAL(8,2) - borne de saisie plus basse que la colonne
  hauteurCuveCm: 1e4,
  puissanceKva: 1e4,
} as const;

/** Une mesure retardée de plus que cela n'est plus un rattrapage mais une erreur de date. */
export const ANCIENNETE_MAX_JOURS = 730;
const TOLERANCE_FUTUR_MS = 5 * 60_000;
const OBSERVATIONS_MAX = 500;

export interface SaisieGroupe { groupeId: string | null; indexHeuresGE: number }

export interface SaisieHorsApp {
  siteId: string;
  dateReleve: Date;
  /** La personne qui a PRIS le relevé, quand on la connaît (≠ l'administrateur qui saisit). */
  technicienId: string | null;
  observations: string | null;
  ceet: { indexCompteur: number } | null;
  solaire: { puissanceKva: number } | null;
  ge: {
    volumeGasoilLitres: number | null;
    hauteurCuveCm: number | null;
    groupes: SaisieGroupe[];
  } | null;
}

const invalide = (message: string) => new AppError(message, 422);

/**
 * Nombre saisi : un nombre, ou un texte à la française (« 12 345,6 »). Vide =
 * `null`. Négatif, non numérique ou au-delà de la capacité de la colonne = refus.
 */
export function nombreSaisi(brut: unknown, max: number, libelle: string): number | null {
  if (brut === null || brut === undefined) return null;
  let n: number;
  if (typeof brut === 'number') {
    n = brut;
  } else if (typeof brut === 'string') {
    const net = brut.replace(/[\s  ]/g, '').replace(',', '.');
    if (net === '') return null;
    // Number('12abc') vaut NaN mais Number('0x10') vaut 16 : on exige un décimal plein.
    if (!/^-?\d+(\.\d+)?$/.test(net)) throw invalide(`${libelle} invalide : un nombre est attendu.`);
    n = Number(net);
  } else {
    throw invalide(`${libelle} invalide : un nombre est attendu.`);
  }
  if (!Number.isFinite(n)) throw invalide(`${libelle} invalide : un nombre est attendu.`);
  if (n < 0) throw invalide(`${libelle} ne peut pas être négatif.`);
  if (n >= max) throw invalide(`${libelle} trop élevé (${n.toLocaleString('fr-FR')}) : vérifiez la saisie.`);
  return n;
}

/** Date et heure de la mesure : obligatoire, ni dans le futur, ni plus vieille que le rattrapage raisonnable. */
export function dateDeMesure(brut: unknown, maintenant: Date = new Date()): Date {
  if (brut === null || brut === undefined || brut === '') {
    throw invalide('La date et l\'heure du relevé sont requises.');
  }
  const d = brut instanceof Date ? brut : new Date(String(brut));
  if (!Number.isFinite(d.getTime())) throw invalide('Date du relevé invalide.');
  if (d.getTime() > maintenant.getTime() + TOLERANCE_FUTUR_MS) {
    throw invalide('La date du relevé est dans le futur.');
  }
  if (d.getTime() < maintenant.getTime() - ANCIENNETE_MAX_JOURS * 86_400_000) {
    throw invalide(`Relevé trop ancien : au plus ${ANCIENNETE_MAX_JOURS} jours (2 ans) en arrière. Vérifiez l'année.`);
  }
  return d;
}

const objet = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

export function validerSaisieHorsApp(corps: unknown, maintenant: Date = new Date()): SaisieHorsApp {
  const b = objet(corps);
  if (!b) throw invalide('Saisie illisible.');

  const siteId = typeof b.siteId === 'string' ? b.siteId.trim() : '';
  if (!siteId) throw invalide('Le site est requis.');

  const dateReleve = dateDeMesure(b.dateReleve, maintenant);

  const technicienId = typeof b.technicienId === 'string' && b.technicienId.trim() ? b.technicienId.trim() : null;

  let observations: string | null = null;
  if (b.observations != null && String(b.observations).trim() !== '') {
    observations = String(b.observations).trim();
    if (observations.length > OBSERVATIONS_MAX) {
      throw invalide(`Observations trop longues (${OBSERVATIONS_MAX} caractères au plus).`);
    }
  }

  // ── Compteur CEET ──
  let ceet: SaisieHorsApp['ceet'] = null;
  const bc = objet(b.ceet);
  if (bc) {
    const indexCompteur = nombreSaisi(bc.indexCompteur, MAX.indexCompteur, 'Index du compteur CEET');
    if (indexCompteur != null) ceet = { indexCompteur };
  }

  // ── Solaire ──
  let solaire: SaisieHorsApp['solaire'] = null;
  const bs = objet(b.solaire);
  if (bs) {
    const puissanceKva = nombreSaisi(bs.puissanceKva, MAX.puissanceKva, 'Puissance solaire');
    if (puissanceKva != null) solaire = { puissanceKva };
  }

  // ── Groupe électrogène : jauge de cuve et index horaires ──
  let ge: SaisieHorsApp['ge'] = null;
  const bg = objet(b.ge);
  if (bg) {
    const volumeGasoilLitres = nombreSaisi(bg.volumeGasoilLitres, MAX.volumeGasoilLitres, 'Volume de gasoil');
    const hauteurCuveCm = nombreSaisi(bg.hauteurCuveCm, MAX.hauteurCuveCm, 'Hauteur de cuve');

    const groupes: SaisieGroupe[] = [];
    const vus = new Set<string>();
    if (bg.groupes != null && !Array.isArray(bg.groupes)) throw invalide('Liste des groupes illisible.');
    for (const [i, g] of ((bg.groupes as unknown[] | undefined) ?? []).entries()) {
      const o = objet(g);
      if (!o) throw invalide(`Groupe n°${i + 1} illisible.`);
      const index = nombreSaisi(o.indexHeuresGE, MAX.indexHeuresGE, `Index horaire du groupe n°${i + 1}`);
      if (index == null) continue; // groupe laissé vide : rien à enregistrer pour lui
      const groupeId = typeof o.groupeId === 'string' && o.groupeId.trim() ? o.groupeId.trim() : null;
      const cle = groupeId ?? '_';
      if (vus.has(cle)) throw invalide('Un même groupe électrogène est saisi deux fois.');
      vus.add(cle);
      groupes.push({ groupeId, indexHeuresGE: index });
    }

    if (volumeGasoilLitres != null || hauteurCuveCm != null || groupes.length) {
      ge = { volumeGasoilLitres, hauteurCuveCm, groupes };
    }
  }

  if (!ceet && !solaire && !ge) {
    throw invalide('Aucune mesure saisie : renseignez au moins un index, une jauge ou une puissance.');
  }

  return { siteId, dateReleve, technicienId, observations, ceet, solaire, ge };
}
