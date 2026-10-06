import crypto from 'crypto';
import { Pool, PoolClient, DatabaseError } from 'pg';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';

/**
 * CONSOLE SQL DE L'ADMINISTRATEUR - LECTURE SEULE GARANTIE PAR POSTGRESQL.
 *
 * L'application se connecte en SUPERUTILISATEUR. Endosser un rôle restreint le
 * temps d'une requête (SET LOCAL ROLE) ne suffit pas : depuis une session de
 * superutilisateur, `set_config('session_authorization', …)` rend l'identité
 * d'origine au milieu même de la requête, et `query_to_xml(…)` relit alors ce
 * que le rôle n'avait pas le droit de voir. Vérifié, pas supposé.
 *
 * La console ouvre donc SA PROPRE CONNEXION, sous le rôle `emops_lecture`
 * (migration 0072) : une session qui n'est pas superutilisateur ne peut pas
 * redevenir quelqu'un d'autre. Ce rôle n'a que SELECT, sans les colonnes
 * sensibles de `users`, et chaque requête tourne dans une transaction en
 * lecture seule, bornée en durée et en nombre de lignes.
 *
 * Son mot de passe est DÉRIVÉ du secret du serveur (HMAC) et posé par l'API à
 * la première ouverture : rien à ajouter au déploiement, stable d'un
 * redémarrage à l'autre, et inutilisable sans le secret qui protège déjà tout.
 *
 * Le contrôle du TEXTE de la requête (une seule instruction, qui commence par
 * SELECT, WITH…) n'est qu'un confort : il donne un message clair. La garantie,
 * elle, vient des droits PostgreSQL.
 */

const ROLE = 'emops_lecture';
export const LIGNES_MAX = 1000;
const DUREE_MAX = '15s';

/** Colonnes rendues illisibles par la migration 0072 : citées dans les messages d'erreur. */
const COLONNES_PROTEGEES = ['users.password_hash', 'users.fcm_token'];

let pool: Pool | null = null;
let preparation: Promise<Pool> | null = null;

const motDePasse = () =>
  crypto.createHmac('sha256', env.JWT_SECRET).update('emops-console-sql/v1').digest('hex');

/**
 * Prépare (une fois par processus) le rôle et sa connexion. Refuse d'ouvrir la
 * console si le rôle manque, ou s'il a été doté d'un privilège qu'il ne doit
 * pas avoir : on préfère une console fermée à une console trop puissante.
 */
async function ouvrir(): Promise<Pool> {
  const [role] = await prisma.$queryRawUnsafe<Array<{ super: boolean; createrole: boolean; createdb: boolean; membre: boolean }>>(
    `SELECT r.rolsuper AS super, r.rolcreaterole AS createrole, r.rolcreatedb AS createdb,
            EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = r.oid) AS membre
       FROM pg_roles r WHERE r.rolname = $1`,
    ROLE,
  );
  if (!role) {
    throw new AppError('Console SQL indisponible : le rôle de lecture n\'existe pas (migration 0072 non appliquée).', 503);
  }
  // Membre d'un autre rôle = il pourrait en endosser les droits.
  if (role.super || role.createrole || role.createdb || role.membre) {
    throw new AppError('Console SQL fermée : le rôle de lecture a des privilèges qu\'il ne doit pas avoir.', 503);
  }

  // Le mot de passe est de l'hexadécimal : aucune apostrophe possible.
  await prisma.$executeRawUnsafe(`ALTER ROLE ${ROLE} WITH LOGIN PASSWORD '${motDePasse()}' CONNECTION LIMIT 3`);

  const url = new URL(env.DATABASE_URL);
  url.username = ROLE;
  url.password = motDePasse();
  // Paramètres propres à Prisma, inconnus du pilote pg.
  for (const p of ['connection_limit', 'pool_timeout', 'schema']) url.searchParams.delete(p);

  const p = new Pool({
    connectionString: url.toString(),
    max: 2,
    idleTimeoutMillis: 30_000,
    application_name: 'emops-console-sql',
  });
  p.on('error', (e) => logger.warn('[console-sql] connexion perdue:', e.message));
  pool = p;
  return p;
}

async function connexion(): Promise<Pool> {
  if (pool) return pool;
  preparation ??= ouvrir().finally(() => { preparation = null; });
  return preparation;
}

/** Ferme la connexion de la console (arrêt du serveur, tests). */
export async function fermerConsole(): Promise<void> {
  const p = pool;
  pool = null;
  await p?.end();
}

// ── Texte de la requête ──────────────────────────────────────

const DEBUTS_PERMIS = /^(select|with|values|table|explain)\b/i;

/**
 * Lit le texte comme le ferait PostgreSQL pour ce qui nous importe : retire les
 * commentaires (en ligne avec deux tirets, ou en bloc barre-étoile) et repère
 * les points-virgules, mais JAMAIS à
 * l'intérieur d'une chaîne ('…', avec '' échappé) ou d'un identifiant entre
 * guillemets ("…"). Une regex aurait coupé `where nom like '%--%'` en deux.
 */
export function analyserTexte(brut: string): { sansCommentaires: string; pointsVirgules: number[] } {
  let out = '';
  const pointsVirgules: number[] = [];
  let i = 0;
  while (i < brut.length) {
    const ch = brut[i];
    const suivant = brut[i + 1];
    if (ch === "'" || ch === '"') {
      // Chaîne ou identifiant : copié tel quel jusqu'au délimiteur fermant (doublé = échappé).
      let j = i + 1;
      while (j < brut.length) {
        if (brut[j] === ch) {
          if (brut[j + 1] === ch) { j += 2; continue; }
          break;
        }
        j++;
      }
      out += brut.slice(i, j + 1);
      i = j + 1;
    } else if (ch === '-' && suivant === '-') {
      const fin = brut.indexOf('\n', i);
      out += ' ';
      i = fin === -1 ? brut.length : fin;
    } else if (ch === '/' && suivant === '*') {
      const fin = brut.indexOf('*/', i + 2);
      out += ' ';
      i = fin === -1 ? brut.length : fin + 2;
    } else {
      if (ch === ';') pointsVirgules.push(out.length);
      out += ch;
      i++;
    }
  }
  return { sansCommentaires: out, pointsVirgules };
}

/**
 * Nettoie et vérifie le texte. Retourne la requête sans commentaires ni
 * point-virgule final, et si c'est un EXPLAIN (qu'on ne peut pas emballer).
 */
export function preparerRequete(brut: unknown): { sql: string; explain: boolean } {
  if (typeof brut !== 'string') throw new AppError('Requête attendue.', 422);
  if (brut.length > 20_000) throw new AppError('Requête trop longue (20 000 caractères au plus).', 422);
  const { sansCommentaires, pointsVirgules } = analyserTexte(brut);
  // Points-virgules finaux tolérés (« select 1; »), aucun autre.
  const sql = sansCommentaires.trimEnd();
  let fin = sql.length;
  while (fin > 0 && /[\s;]/.test(sql[fin - 1])) fin--;
  const nettoyee = sql.slice(0, fin).trim();
  if (!nettoyee) throw new AppError('Requête vide.', 422);
  if (pointsVirgules.some((pos) => pos < fin)) {
    throw new AppError('Une seule instruction à la fois (pas de « ; » au milieu de la requête).', 422);
  }
  if (!DEBUTS_PERMIS.test(nettoyee)) {
    throw new AppError('Console en lecture seule : la requête doit commencer par SELECT, WITH, VALUES, TABLE ou EXPLAIN.', 422);
  }
  return { sql: nettoyee, explain: /^explain\b/i.test(nettoyee) };
}

/** Valeur d'une cellule, telle qu'on peut l'envoyer en JSON et l'afficher. */
export function valeurCellule(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (Buffer.isBuffer(v)) return `<binaire, ${v.length} octet(s)>`;
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

/** Message lisible pour une erreur PostgreSQL. */
export function messageErreur(e: unknown): string {
  const err = e as Partial<DatabaseError> & { message?: string };
  switch (err.code) {
    case '42501':
      return `Accès refusé : ${err.message}. Les colonnes ${COLONNES_PROTEGEES.join(' et ')} et les fonctions d'administration ne sont pas lisibles depuis la console - sur « users », listez les colonnes au lieu de « * ».`;
    case '57014':
      return `Requête interrompue : elle a dépassé ${DUREE_MAX}. Ajoutez un filtre (WHERE) ou une limite.`;
    case '25006':
      return 'La console est en lecture seule : aucune écriture n\'est possible.';
    case '55P03':
      return 'Requête interrompue : une table était verrouillée par une écriture en cours. Réessayez.';
    default:
      return err.message
        ? `${err.message}${err.position ? ` (position ${err.position})` : ''}`
        : 'Erreur inattendue.';
  }
}

export interface ResultatSql {
  colonnes: string[];
  lignes: unknown[][];
  nbLignes: number;
  tronque: boolean;
  dureeMs: number;
}

async function enTransactionLecture<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await (await connexion()).connect();
  try {
    await c.query('BEGIN READ ONLY');
    await c.query(`SET LOCAL statement_timeout = '${DUREE_MAX}'`);
    await c.query(`SET LOCAL lock_timeout = '2s'`);
    return await fn(c);
  } finally {
    await c.query('ROLLBACK').catch(() => undefined);
    c.release();
  }
}

/** Exécute une requête de l'administrateur. Les lignes au-delà de LIGNES_MAX ne sont pas lues. */
export async function executerSql(brut: unknown): Promise<ResultatSql> {
  const { sql, explain } = preparerRequete(brut);
  const debut = Date.now();
  try {
    return await enTransactionLecture(async (c) => {
      // Emballée pour borner les lignes sans dépendre de ce qu'écrit l'utilisateur.
      // `rowMode: array` : deux colonnes de même nom (a.id, b.id) restent deux colonnes.
      const texte = explain ? sql : `SELECT * FROM (${sql}\n) AS console LIMIT ${LIGNES_MAX + 1}`;
      const r = await c.query({ text: texte, rowMode: 'array' });
      const lignes = (r.rows as unknown[][]).slice(0, LIGNES_MAX).map((l) => l.map(valeurCellule));
      return {
        colonnes: r.fields.map((f) => f.name),
        lignes,
        nbLignes: lignes.length,
        tronque: r.rows.length > LIGNES_MAX,
        dureeMs: Date.now() - debut,
      };
    });
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(messageErreur(e), 422);
  }
}

export interface ColonneSchema { table: string; colonne: string; type: string }

/**
 * Tables et colonnes VISIBLES par la console, lues sous son propre rôle : les
 * colonnes protégées n'y figurent donc pas, et l'aide ne promet rien que la
 * console refuserait ensuite.
 */
export async function schemaVisible(): Promise<ColonneSchema[]> {
  return enTransactionLecture(async (c) => {
    const r = await c.query<{ table: string; colonne: string; type: string }>(
      `SELECT c.table_name AS table, c.column_name AS colonne, c.data_type AS type
         FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND has_column_privilege(current_user, format('%I.%I', c.table_schema, c.table_name), c.column_name, 'SELECT')
          AND c.table_name <> '_prisma_migrations'
        ORDER BY c.table_name, c.ordinal_position`,
    );
    return r.rows;
  });
}
