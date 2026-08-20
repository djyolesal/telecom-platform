import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../config/database';

/**
 * Références lisibles des interventions : MNT-2026-00481, INC-2026-00112,
 * DEP-2026-01893, MVT-2026-00042 — séquentielles par type et par ANNÉE MÉTIER
 * (date planifiée / d'ouverture / de dépotage / du mouvement). Compteur en base (compteurs_reference) incrémenté
 * atomiquement : fiable même sous créations simultanées. Les UUID restent les
 * clés techniques ; la référence sert aux humains (téléphone, PDF, recherche).
 */
// MVT : mouvements de carburant hors livraison (transfert, purge, avoir).
export type TypeReference = 'MNT' | 'INC' | 'DEP' | 'MVT';

type Db = PrismaClient | Prisma.TransactionClient;

/** Prochain numéro du compteur (créé à 1 si première référence de l'année). */
async function prochainNumero(db: Db, type: TypeReference, annee: number, pas = 1): Promise<number> {
  const rows = await db.$queryRaw<{ dernier: number }[]>`
    INSERT INTO "compteurs_reference" ("type", "annee", "dernier") VALUES (${type}, ${annee}, ${pas})
    ON CONFLICT ("type", "annee") DO UPDATE SET "dernier" = "compteurs_reference"."dernier" + ${pas}
    RETURNING "dernier"`;
  return rows[0].dernier;
}

export function formatReference(type: TypeReference, annee: number, numero: number): string {
  return `${type}-${annee}-${String(numero).padStart(5, '0')}`;
}

/** Génère UNE référence (à appeler avec le client de la transaction en cours). */
export async function genererReference(db: Db, type: TypeReference, dateMetier: Date): Promise<string> {
  const annee = dateMetier.getFullYear();
  return formatReference(type, annee, await prochainNumero(db, type, annee));
}

/**
 * Aligne le compteur AU MOINS à `numero` - rattrapage quand des références
 * existent sans avoir consommé le compteur (import de données réelles) : la
 * première création suivante partait en conflit unique (P2002).
 */
export async function alignerCompteur(db: Db, type: TypeReference, annee: number, numero: number): Promise<void> {
  await db.$executeRaw`
    INSERT INTO "compteurs_reference" ("type", "annee", "dernier") VALUES (${type}, ${annee}, ${numero})
    ON CONFLICT ("type", "annee") DO UPDATE SET "dernier" = GREATEST("compteurs_reference"."dernier", ${numero})`;
}

/**
 * Réserve un BLOC de n numéros consécutifs (imports en masse) → premier numéro.
 * Passer le client de transaction (`db`) pour que la réservation soit ATOMIQUE
 * avec l'insertion : sinon un échec d'insertion laissait le compteur avancé
 * (trous de numérotation à chaque rejeu).
 */
export async function reserverReferences(type: TypeReference, annee: number, n: number, db: Db = prisma): Promise<number> {
  if (n <= 0) return 0;
  const dernier = await prochainNumero(db, type, annee, n);
  return dernier - n + 1;
}
