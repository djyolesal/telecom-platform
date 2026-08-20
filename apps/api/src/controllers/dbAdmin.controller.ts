import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { auditLog } from '../services/audit.service';
import { sendTabular, EXPORT_MAX } from '../utils/exporter';
import {
  ChampDb,
  ModeleDb,
  LIBELLES_GROUPES,
  catalogue,
  champsLisibles,
  construireData,
  delegate,
  impactSuppression,
  libelleLigne,
  modeleOuErreur,
  selectionLecture,
  serialiserLigne,
  valeursEnum,
} from '../services/dbAdmin.service';

/**
 * Console d'administration de la base de données (ADMIN uniquement).
 *
 * Consultation ET écriture sur toutes les tables du modèle, à partir du
 * catalogue dérivé de schema.prisma. Trois garde-fous portent la sécurité :
 *  1. le nom de table demandé doit exister dans le catalogue (liste blanche) —
 *     aucun accès arbitraire à un delegate Prisma ;
 *  2. chaque valeur est convertie et validée selon le type déclaré au schéma ;
 *  3. toute écriture est tracée dans le journal d'audit, avec l'avant/après.
 */

const LIMITE_OPTIONS = 50;

// ── Catalogue ────────────────────────────────────────────────

/** Tailles disque par table (approximation Postgres, index compris). */
async function taillesTables(): Promise<Map<string, number>> {
  try {
    const lignes = await prisma.$queryRaw<Array<{ table: string; taille: bigint }>>`
      SELECT c.relname AS "table", pg_total_relation_size(c.oid) AS taille
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
    `;
    return new Map(lignes.map((l) => [l.table, Number(l.taille)]));
  } catch {
    // Une base sans droit sur les catalogues ne doit pas casser la page.
    return new Map();
  }
}

export async function listerTables(_req: Request, res: Response, next: NextFunction) {
  try {
    const modeles = [...catalogue().modeles.values()];
    const [tailles, comptes] = await Promise.all([
      taillesTables(),
      Promise.all(modeles.map((m) => delegate(m).count().catch(() => -1))),
    ]);

    res.json({
      success: true,
      data: {
        groupes: LIBELLES_GROUPES,
        tables: modeles.map((m, i) => ({
          modele: m.nom,
          table: m.table,
          libelle: m.libelle,
          groupe: m.groupe,
          lectureSeule: m.lectureSeule,
          lignes: comptes[i],
          octets: tailles.get(m.table) ?? null,
          colonnes: m.champs.filter((c) => c.kind !== 'relation' && !c.liste).length,
        })),
      },
    });
  } catch (err) { next(err); }
}

/** Métadonnées d'une table : champs, types, enums, relations. */
export function decrireTable(req: Request, res: Response, next: NextFunction) {
  try {
    const modele = modeleOuErreur(req.params.modele);
    const enums: Record<string, string[]> = {};
    for (const champ of modele.champs) {
      if (champ.kind === 'enum') enums[champ.type] = valeursEnum(champ.type);
    }
    res.json({
      success: true,
      data: {
        modele: modele.nom,
        table: modele.table,
        libelle: modele.libelle,
        groupe: modele.groupe,
        idChamp: modele.idChamp,
        lectureSeule: modele.lectureSeule,
        enums,
        champs: modele.champs
          .filter((c) => !c.liste)
          .map((c) => ({
            nom: c.nom,
            type: c.type,
            kind: c.kind,
            obligatoire: c.obligatoire,
            estId: c.estId,
            unique: c.unique,
            defaut: c.defaut ?? null,
            colonne: c.colonne ?? null,
            longueurMax: c.longueurMax ?? null,
            aide: c.aide ?? null,
            fkVers: c.fkVers ?? null,
            modifiable: c.modifiable,
            creable: c.creable,
            secret: c.secret,
          })),
        // Tables pointant vers celle-ci, avec le sort réservé à leurs lignes
        // quand on supprime ici (Cascade / SetNull / Restrict).
        referencePar: [...catalogue().modeles.values()].flatMap((m) =>
          m.champs
            .filter((c) => c.fkVers === modele.nom && !c.liste)
            .map((c) => ({ modele: m.nom, libelle: m.libelle, champ: c.nom, action: c.surSuppression ?? 'Restrict' }))
        ),
      },
    });
  } catch (err) { next(err); }
}

// ── Lecture des lignes ───────────────────────────────────────

/** Recherche plein-texte simple : contient (insensible) sur les champs texte. */
function clauseRecherche(modele: ModeleDb, q: string): Record<string, unknown> | null {
  const terme = q.trim();
  if (!terme) return null;
  const ou: Array<Record<string, unknown>> = [];
  for (const champ of champsLisibles(modele)) {
    if (champ.type === 'String') ou.push({ [champ.nom]: { contains: terme, mode: 'insensitive' } });
    // Un enum ne supporte pas `contains` : on teste l'égalité sur la valeur saisie.
    if (champ.kind === 'enum' && valeursEnum(champ.type).includes(terme.toUpperCase())) {
      ou.push({ [champ.nom]: terme.toUpperCase() });
    }
  }
  return ou.length ? { OR: ou } : null;
}

/** Filtres exacts passés en `f_<champ>=valeur`. */
async function clausesFiltres(modele: ModeleDb, query: Record<string, unknown>): Promise<Array<Record<string, unknown>>> {
  const clauses: Array<Record<string, unknown>> = [];
  for (const [cle, valeur] of Object.entries(query)) {
    if (!cle.startsWith('f_') || typeof valeur !== 'string' || valeur === '') continue;
    const champ = modele.champs.find((c) => c.nom === cle.slice(2) && c.kind !== 'relation' && !c.liste && !c.secret);
    if (!champ) continue;
    if (valeur === '@null') { clauses.push({ [champ.nom]: null }); continue; }
    if (champ.type === 'String') { clauses.push({ [champ.nom]: { contains: valeur, mode: 'insensitive' } }); continue; }
    if (champ.type === 'DateTime') {
      // `f_dateX=2026-08-01` → toute la journée.
      const debut = new Date(valeur);
      if (Number.isNaN(debut.getTime())) continue;
      const fin = new Date(debut);
      fin.setDate(fin.getDate() + 1);
      clauses.push({ [champ.nom]: { gte: debut, lt: fin } });
      continue;
    }
    if (champ.kind === 'enum') {
      if (valeursEnum(champ.type).includes(valeur)) clauses.push({ [champ.nom]: valeur });
      continue;
    }
    if (champ.type === 'Boolean') { clauses.push({ [champ.nom]: valeur === 'true' }); continue; }
    const n = Number(valeur);
    if (Number.isFinite(n)) clauses.push({ [champ.nom]: n });
  }
  return clauses;
}

function ordreDeTri(modele: ModeleDb, tri?: string, sens?: string): Record<string, 'asc' | 'desc'> {
  const dir: 'asc' | 'desc' = sens === 'asc' ? 'asc' : 'desc';
  const demande = modele.champs.find((c) => c.nom === tri && c.kind !== 'relation' && !c.liste && !c.secret);
  if (demande) return { [demande.nom]: dir };
  const parDefaut = modele.champs.find((c) => c.nom === 'createdAt') ?? modele.champs.find((c) => c.nom === modele.idChamp);
  return { [parDefaut?.nom ?? modele.idChamp]: 'desc' };
}

/**
 * Libellés des lignes visées par les clés étrangères de la page courante :
 * la console affiche « Lomé-Centre » plutôt qu'un uuid, sans exiger de jointure
 * ni charger les relations complètes.
 */
async function libellesRelations(
  modele: ModeleDb,
  lignes: Array<Record<string, unknown>>
): Promise<Record<string, Record<string, string>>> {
  const fks = modele.champs.filter((c) => c.fkVers && !c.liste);
  const out: Record<string, Record<string, string>> = {};

  await Promise.all(
    fks.map(async (champ) => {
      const ids = [...new Set(lignes.map((l) => l[champ.nom]).filter((v): v is string => typeof v === 'string' && v !== ''))];
      if (!ids.length) return;
      const cible = catalogue().modeles.get(champ.fkVers as string);
      if (!cible) return;
      const select: Record<string, boolean> = { [cible.idChamp]: true };
      for (const c of cible.champsLibelle) select[c] = true;
      const cibles: Array<Record<string, unknown>> = await delegate(cible).findMany({
        where: { [cible.idChamp]: { in: ids } },
        select,
      });
      out[champ.nom] = Object.fromEntries(cibles.map((c) => [String(c[cible.idChamp]), libelleLigne(cible, c)]));
    })
  );

  return out;
}

export async function listerLignes(req: Request, res: Response, next: NextFunction) {
  try {
    const modele = modeleOuErreur(req.params.modele);
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 25));

    const clauses: Array<Record<string, unknown>> = await clausesFiltres(modele, req.query as Record<string, unknown>);
    const recherche = typeof req.query.q === 'string' ? clauseRecherche(modele, req.query.q) : null;
    if (recherche) clauses.push(recherche);
    const where = clauses.length ? { AND: clauses } : {};

    const d = delegate(modele);
    const [lignes, total] = await Promise.all([
      d.findMany({
        where,
        select: selectionLecture(modele),
        orderBy: ordreDeTri(modele, req.query.tri as string, req.query.sens as string),
        skip: (page - 1) * limit,
        take: limit,
      }) as Promise<Array<Record<string, unknown>>>,
      d.count({ where }) as Promise<number>,
    ]);

    const totalPages = Math.ceil(total / limit) || 1;
    res.json({
      success: true,
      data: lignes.map(serialiserLigne),
      relations: await libellesRelations(modele, lignes),
      meta: { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
    });
  } catch (err) { next(err); }
}

export async function lireLigne(req: Request, res: Response, next: NextFunction) {
  try {
    const modele = modeleOuErreur(req.params.modele);
    const ligne = await delegate(modele).findUnique({
      where: { [modele.idChamp]: req.params.id },
      select: selectionLecture(modele),
    });
    if (!ligne) throw new AppError('Enregistrement introuvable', 404);
    res.json({
      success: true,
      data: serialiserLigne(ligne),
      relations: await libellesRelations(modele, [ligne]),
    });
  } catch (err) { next(err); }
}

/**
 * Inventaire de ce qu'emporterait la suppression d'une ligne. Le panneau de la
 * console l'affiche AVANT de demander confirmation.
 */
export async function impactLigne(req: Request, res: Response, next: NextFunction) {
  try {
    const modele = modeleOuErreur(req.params.modele);
    const existe = await delegate(modele).findUnique({
      where: { [modele.idChamp]: req.params.id },
      select: { [modele.idChamp]: true },
    });
    if (!existe) throw new AppError('Enregistrement introuvable', 404);
    res.json({ success: true, data: await impactSuppression(modele, req.params.id) });
  } catch (err) { next(err); }
}

/** Valeurs proposées pour une clé étrangère (sélecteur du formulaire). */
export async function optionsTable(req: Request, res: Response, next: NextFunction) {
  try {
    const modele = modeleOuErreur(req.params.modele);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const where = q ? clauseRecherche(modele, q) ?? {} : {};
    const select: Record<string, boolean> = { [modele.idChamp]: true };
    for (const c of modele.champsLibelle) select[c] = true;

    const lignes: Array<Record<string, unknown>> = await delegate(modele).findMany({
      where,
      select,
      orderBy: modele.champsLibelle.length ? { [modele.champsLibelle[0]]: 'asc' } : { [modele.idChamp]: 'asc' },
      take: LIMITE_OPTIONS,
    });

    res.json({
      success: true,
      data: lignes.map((l) => ({ valeur: String(l[modele.idChamp]), libelle: libelleLigne(modele, l) })),
    });
  } catch (err) { next(err); }
}

// ── Écriture ─────────────────────────────────────────────────

/** Ne journalise que les champs réellement fournis, secrets masqués. */
function detailsAudit(modele: ModeleDb, data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [cle, valeur] of Object.entries(data)) {
    const champ = modele.champs.find((c) => c.nom === cle);
    out[cle] = champ?.secret ? '***' : (valeur instanceof Date ? valeur.toISOString() : valeur);
  }
  return out;
}

export async function creerLigne(req: Request, res: Response, next: NextFunction) {
  try {
    const modele = modeleOuErreur(req.params.modele);
    const data = await construireData(modele, req.body ?? {}, 'create');
    const cree = await delegate(modele).create({ data, select: selectionLecture(modele) });

    await auditLog(req.user!.id, 'CREATE', `db:${modele.nom}`, String(cree[modele.idChamp]), {
      table: modele.table,
      champs: detailsAudit(modele, data),
    }, req);

    res.status(201).json({ success: true, data: serialiserLigne(cree) });
  } catch (err) { next(err); }
}

export async function modifierLigne(req: Request, res: Response, next: NextFunction) {
  try {
    const modele = modeleOuErreur(req.params.modele);
    const data = await construireData(modele, req.body ?? {}, 'update');

    const avant = await delegate(modele).findUnique({
      where: { [modele.idChamp]: req.params.id },
      select: selectionLecture(modele),
    });
    if (!avant) throw new AppError('Enregistrement introuvable', 404);

    const apres = await delegate(modele).update({
      where: { [modele.idChamp]: req.params.id },
      data,
      select: selectionLecture(modele),
    });

    // L'audit garde l'avant/après des SEULS champs touchés : un diff lisible
    // vaut mieux qu'une copie intégrale de la ligne à chaque modification.
    const diff: Record<string, { avant: unknown; apres: unknown }> = {};
    for (const cle of Object.keys(data)) {
      const champ = modele.champs.find((c) => c.nom === cle);
      diff[cle] = champ?.secret
        ? { avant: '***', apres: '***' }
        : { avant: serialiserLigne(avant)[cle] ?? null, apres: serialiserLigne(apres)[cle] ?? null };
    }
    await auditLog(req.user!.id, 'UPDATE', `db:${modele.nom}`, req.params.id, { table: modele.table, diff }, req);

    res.json({ success: true, data: serialiserLigne(apres) });
  } catch (err) { next(err); }
}

export async function supprimerLigne(req: Request, res: Response, next: NextFunction) {
  try {
    const modele = modeleOuErreur(req.params.modele);
    if (modele.lectureSeule) throw new AppError(`« ${modele.libelle} » est en consultation seule`, 403);

    const avant = await delegate(modele).findUnique({
      where: { [modele.idChamp]: req.params.id },
      select: selectionLecture(modele),
    });
    if (!avant) throw new AppError('Enregistrement introuvable', 404);

    // Relevé AVANT suppression : après, les lignes en cascade n'existent plus
    // et le journal ne pourrait plus dire ce qui a disparu avec elles.
    const impacts = await impactSuppression(modele, req.params.id);

    try {
      await delegate(modele).delete({ where: { [modele.idChamp]: req.params.id } });
    } catch (err) {
      // P2003 : d'autres lignes référencent celle-ci. Le message générique du
      // gestionnaire central (« référence invalide ») induirait en erreur.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        const sources = [...catalogue().modeles.values()]
          .filter((m) => m.champs.some((c) => c.fkVers === modele.nom))
          .map((m) => m.libelle);
        throw new AppError(
          `Suppression refusée : d'autres enregistrements référencent cette ligne${sources.length ? ` (${sources.join(', ')})` : ''}. Supprimez-les d'abord.`,
          409
        );
      }
      throw err;
    }

    await auditLog(req.user!.id, 'DELETE', `db:${modele.nom}`, req.params.id, {
      table: modele.table,
      libelle: libelleLigne(modele, avant),
      supprime: serialiserLigne(avant),
      // Lignes liées emportées (Cascade) ou déliées (SetNull) par ricochet.
      consequences: impacts.filter((i) => i.action === 'Cascade' || i.action === 'SetNull'),
    }, req);

    res.json({ success: true, message: 'Enregistrement supprimé' });
  } catch (err) { next(err); }
}

// ── Export ───────────────────────────────────────────────────

export async function exporterTable(req: Request, res: Response, next: NextFunction) {
  try {
    const modele = modeleOuErreur(req.params.modele);
    const clauses = await clausesFiltres(modele, req.query as Record<string, unknown>);
    const recherche = typeof req.query.q === 'string' ? clauseRecherche(modele, req.query.q) : null;
    if (recherche) clauses.push(recherche);

    const lignes: Array<Record<string, unknown>> = await delegate(modele).findMany({
      where: clauses.length ? { AND: clauses } : {},
      select: selectionLecture(modele),
      orderBy: ordreDeTri(modele, req.query.tri as string, req.query.sens as string),
      take: EXPORT_MAX,
    });

    const colonnes: ChampDb[] = champsLisibles(modele);
    await auditLog(req.user!.id, 'EXPORT', `db:${modele.nom}`, undefined, { table: modele.table, lignes: lignes.length }, req);

    await sendTabular(
      res,
      req.params.format,
      `base-${modele.table}`,
      modele.libelle,
      [{
        name: modele.libelle.slice(0, 30),
        columns: colonnes.map((c) => ({ key: c.nom, header: c.nom, width: 22 })),
        rows: lignes.map((l) => serialiserLigne(l)),
      }],
      `Table ${modele.table} — ${lignes.length} ligne(s)${lignes.length === EXPORT_MAX ? ' (export plafonné)' : ''}`
    );
  } catch (err) { next(err); }
}
