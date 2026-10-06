import { AppError } from './AppError';

/**
 * FILTRES DE LA CONSOLE BASE DE DONNÉES.
 *
 * Syntaxe de la requête :
 *   f_<colonne>=valeur              forme historique (égalité ; « contient » pour un texte)
 *   f_<colonne>__<opérateur>=valeur forme complète, plusieurs par colonne possibles :
 *                                   f_dateFin__gte=2026-09-01&f_dateFin__lte=2026-09-30
 *
 * Un filtre mal formé est REFUSÉ (422), jamais ignoré : sur une console
 * d'administration, un filtre silencieusement écarté affiche la table entière
 * en laissant croire qu'elle est filtrée - c'est pire qu'une erreur.
 */

export type Operateur =
  | 'eq' | 'ne' | 'contient' | 'commence'
  | 'gt' | 'gte' | 'lt' | 'lte'
  | 'in' | 'vide' | 'nonvide';

export interface ChampFiltrable {
  nom: string;
  type: string;
  kind: 'scalar' | 'enum' | 'relation';
  obligatoire: boolean;
  fkVers?: string;
}

const NUMERIQUES = new Set(['Int', 'Float', 'Decimal', 'BigInt']);
const JOUR = /^\d{4}-\d{2}-\d{2}$/;

/** Opérateurs permis pour une colonne : ce que le type de la colonne a de sens. */
export function operateursPour(champ: ChampFiltrable): Operateur[] {
  const nullable: Operateur[] = champ.obligatoire ? [] : ['vide', 'nonvide'];
  if (champ.kind === 'enum') return ['eq', 'ne', 'in', ...nullable];
  if (champ.type === 'Boolean') return ['eq', ...nullable];
  if (champ.fkVers) return ['eq', 'ne', ...nullable];
  if (champ.type === 'String') return ['contient', 'eq', 'ne', 'commence', ...nullable];
  if (NUMERIQUES.has(champ.type) || champ.type === 'DateTime') {
    return ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', ...nullable];
  }
  return nullable; // Json, Bytes… : seule la présence se filtre
}

/** L'opérateur implicite de la forme historique `f_<colonne>=valeur`. */
export const operateurParDefaut = (champ: ChampFiltrable): Operateur =>
  champ.type === 'String' && !champ.fkVers && champ.kind !== 'enum' ? 'contient' : 'eq';

const refus = (champ: ChampFiltrable, message: string) =>
  new AppError(`Filtre sur « ${champ.nom} » : ${message}`, 422);

function nombre(champ: ChampFiltrable, v: string): number | bigint {
  const net = v.trim().replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(net)) throw refus(champ, `« ${v} » n'est pas un nombre.`);
  if (champ.type === 'BigInt') return BigInt(net.split('.')[0]);
  return Number(net);
}

/** Début du jour (UTC - le Togo est à UTC+0) d'une valeur « AAAA-MM-JJ », ou l'instant exact d'une date complète. */
function instant(champ: ChampFiltrable, v: string): { debut: Date; finJour: Date | null } {
  const t = v.trim();
  const d = new Date(JOUR.test(t) ? `${t}T00:00:00.000Z` : t);
  if (Number.isNaN(d.getTime())) throw refus(champ, `« ${v} » n'est pas une date (AAAA-MM-JJ attendu).`);
  if (!JOUR.test(t)) return { debut: d, finJour: null };
  return { debut: d, finJour: new Date(d.getTime() + 86_400_000) };
}

/**
 * Clause Prisma d'UN filtre. `enums` : valeurs permises quand la colonne est
 * une énumération.
 */
export function clauseFiltre(
  champ: ChampFiltrable,
  op: Operateur,
  valeur: string,
  enums: string[] = [],
): Record<string, unknown> {
  const c = champ.nom;
  if (!operateursPour(champ).includes(op)) {
    throw refus(champ, `l'opérateur « ${op} » ne s'applique pas à une colonne de type ${champ.type}.`);
  }
  if (op === 'vide') return { [c]: null };
  if (op === 'nonvide') return { [c]: { not: null } };

  /**
   * « ≠ » garde les lignes VIDES : en SQL, NULL <> 'x' ne vaut pas vrai, et un
   * `{ not: x }` seul les écarterait. Quelqu'un qui demande « statut différent
   * de TERMINEE » veut aussi les lignes sans statut.
   */
  const different = (valeurClause: unknown) =>
    champ.obligatoire
      ? { [c]: { not: valeurClause } }
      : { OR: [{ [c]: { not: valeurClause } }, { [c]: null }] };

  if (champ.kind === 'enum') {
    const vals = op === 'in' ? valeur.split(',').map((x) => x.trim()).filter(Boolean) : [valeur.trim()];
    const inconnues = vals.filter((x) => !enums.includes(x));
    if (!vals.length || inconnues.length) {
      throw refus(champ, `valeur inconnue (${inconnues.join(', ') || 'vide'}). Valeurs possibles : ${enums.join(', ')}.`);
    }
    if (op === 'in') return { [c]: { in: vals } };
    return op === 'ne' ? different(vals[0]) : { [c]: vals[0] };
  }

  if (champ.type === 'Boolean') {
    if (valeur !== 'true' && valeur !== 'false') throw refus(champ, 'oui (true) ou non (false) attendu.');
    return { [c]: valeur === 'true' };
  }

  if (champ.fkVers) {
    const id = valeur.trim();
    if (!id) throw refus(champ, 'identifiant vide.');
    return op === 'ne' ? different(id) : { [c]: id };
  }

  if (champ.type === 'String') {
    if (valeur === '') throw refus(champ, 'valeur vide (utilisez « est vide »).');
    switch (op) {
      case 'contient': return { [c]: { contains: valeur, mode: 'insensitive' } };
      case 'commence': return { [c]: { startsWith: valeur, mode: 'insensitive' } };
      case 'eq': return { [c]: { equals: valeur, mode: 'insensitive' } };
      case 'ne': return different({ equals: valeur, mode: 'insensitive' });
      default: break;
    }
  }

  if (NUMERIQUES.has(champ.type)) {
    const n = nombre(champ, valeur);
    switch (op) {
      case 'eq': return { [c]: n };
      case 'ne': return different(n);
      case 'gt': case 'gte': case 'lt': case 'lte': return { [c]: { [op]: n } };
      default: break;
    }
  }

  if (champ.type === 'DateTime') {
    const { debut, finJour } = instant(champ, valeur);
    // Un JOUR se lit comme une journée entière : « avant le 30 » exclut le 30,
    // « jusqu'au 30 » (≤) l'inclut. Une date complète se compare à l'instant.
    switch (op) {
      case 'eq': return finJour ? { [c]: { gte: debut, lt: finJour } } : { [c]: debut };
      case 'ne': return finJour
        ? (champ.obligatoire
          ? { OR: [{ [c]: { lt: debut } }, { [c]: { gte: finJour } }] }
          : { OR: [{ [c]: { lt: debut } }, { [c]: { gte: finJour } }, { [c]: null }] })
        : different(debut);
      case 'gt': return { [c]: { gte: finJour ?? new Date(debut.getTime() + 1) } };
      case 'gte': return { [c]: { gte: debut } };
      case 'lt': return { [c]: { lt: debut } };
      case 'lte': return { [c]: finJour ? { lt: finJour } : { lte: debut } };
      default: break;
    }
  }

  throw refus(champ, `l'opérateur « ${op} » ne s'applique pas ici.`);
}

const OPERATEURS: ReadonlySet<string> = new Set<Operateur>(['eq', 'ne', 'contient', 'commence', 'gt', 'gte', 'lt', 'lte', 'in', 'vide', 'nonvide']);

/**
 * Lit tous les filtres d'une requête. `trouver` renvoie la colonne filtrable
 * (ou undefined : relation, liste, secret, colonne inconnue).
 */
export function clausesDepuisRequete(
  query: Record<string, unknown>,
  trouver: (nom: string) => ChampFiltrable | undefined,
  enumsDe: (champ: ChampFiltrable) => string[],
): Array<Record<string, unknown>> {
  const clauses: Array<Record<string, unknown>> = [];
  for (const [cle, brut] of Object.entries(query)) {
    if (!cle.startsWith('f_')) continue;
    const valeurs = Array.isArray(brut) ? brut : [brut];
    const [nom, opBrut] = cle.slice(2).split('__');
    const champ = trouver(nom);
    if (!champ) throw new AppError(`Filtre sur « ${nom} » : colonne inconnue ou non filtrable.`, 422);
    for (const v of valeurs) {
      if (typeof v !== 'string') continue;
      // Forme historique : « @null » voulait dire « est vide ».
      if (!opBrut && v === '@null') { clauses.push(clauseFiltre(champ, 'vide', '', enumsDe(champ))); continue; }
      if (!opBrut && v === '') continue;          // sélecteur remis à « tous »
      if (opBrut && !OPERATEURS.has(opBrut)) {
        throw new AppError(`Filtre sur « ${nom} » : opérateur « ${opBrut} » inconnu.`, 422);
      }
      const op = (opBrut as Operateur | undefined) ?? operateurParDefaut(champ);
      clauses.push(clauseFiltre(champ, op, v, enumsDe(champ)));
    }
  }
  return clauses;
}
