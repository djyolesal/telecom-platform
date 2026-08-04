import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { normaliserPlaque, plaqueUtilisable, normaliserNom, nomUtilisable } from '../utils/referentielTransport';

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Résolution des référentiels transport : un véhicule et un chauffeur EXISTENT
 * dès qu'on les nomme, sans imposer une saisie d'administration préalable.
 *
 * Le choix est délibéré : exiger que quelqu'un crée d'abord la fiche du camion
 * aurait bloqué la saisie d'un bon de livraison à 22 h au dépôt, et le terrain
 * aurait contourné en réutilisant une plaque existante — exactement le bruit
 * qu'on cherche à supprimer. Le référentiel se construit donc à l'usage, et
 * l'administration ne fait qu'enrichir (capacité citerne, marque, téléphone).
 */

/** Véhicule correspondant à une plaque, créé au besoin. `null` si inexploitable. */
export async function resoudreVehicule(
  immatriculation: unknown,
  prestataireId: string | null | undefined,
  db: Db = prisma
): Promise<{ id: string; capaciteCiterneLitres: Prisma.Decimal | null } | null> {
  if (!plaqueUtilisable(immatriculation)) return null;
  const cle = normaliserPlaque(immatriculation);
  const libelle = String(immatriculation).trim().slice(0, 30);

  const existant = await db.vehicule.findUnique({
    where: { immatriculation: cle },
    select: { id: true, capaciteCiterneLitres: true, prestataireId: true },
  });
  if (existant) {
    // Un camion changé de transporteur : on rattache s'il n'était pas rattaché,
    // sans jamais écraser une affectation existante (ce serait une décision
    // d'administration, pas un effet de bord d'une saisie de BL).
    if (!existant.prestataireId && prestataireId) {
      await db.vehicule.update({ where: { id: existant.id }, data: { prestataireId } });
    }
    return { id: existant.id, capaciteCiterneLitres: existant.capaciteCiterneLitres };
  }

  const cree = await db.vehicule.create({
    data: { immatriculation: cle, libelle, prestataireId: prestataireId ?? null },
    select: { id: true, capaciteCiterneLitres: true },
  });
  return cree;
}

/** Chauffeur correspondant à un nom, créé au besoin. `null` si inexploitable. */
export async function resoudreChauffeur(
  nom: unknown,
  prestataireId: string | null | undefined,
  db: Db = prisma
): Promise<{ id: string; nom: string } | null> {
  if (!nomUtilisable(nom)) return null;
  const cle = normaliserNom(nom);
  const affiche = String(nom).trim().slice(0, 100);
  const pid = prestataireId ?? null;

  // `findFirst` plutôt qu'`upsert` : la contrainte unique porte sur
  // (prestataireId, nomNormalise) et PostgreSQL considère deux NULL comme
  // distincts — un chauffeur sans transporteur ne serait donc jamais dédupliqué
  // par ON CONFLICT.
  const existant = await db.chauffeur.findFirst({
    where: { nomNormalise: cle, prestataireId: pid },
    select: { id: true, nom: true },
  });
  if (existant) return existant;

  return db.chauffeur.create({
    data: { nom: affiche, nomNormalise: cle, prestataireId: pid },
    select: { id: true, nom: true },
  });
}

/**
 * Un chargement ne peut pas dépasser la capacité de sa citerne. Le contrôle
 * n'est possible que si la capacité est renseignée dans le référentiel : sans
 * elle, on ne bloque rien (mieux vaut pas de contrôle qu'un contrôle imaginaire).
 * Tolérance de 1 % : les capacités nominales sont arrondies.
 */
export function depassementCiterne(
  volumeCharge: number,
  capacite: Prisma.Decimal | number | null | undefined
): { depasse: boolean; capacite: number } {
  const cap = capacite == null ? 0 : Number(capacite);
  if (!Number.isFinite(cap) || cap <= 0) return { depasse: false, capacite: 0 };
  return { depasse: volumeCharge > cap * 1.01, capacite: cap };
}
