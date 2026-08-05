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
): Promise<{ id: string; capaciteCiterneLitres: Prisma.Decimal | null; certificatJaugeageExpiration: Date | null } | null> {
  if (!plaqueUtilisable(immatriculation)) return null;
  const cle = normaliserPlaque(immatriculation);
  const libelle = String(immatriculation).trim().slice(0, 30);

  // `upsert` et non findUnique+create : deux bons de livraison créés en même
  // temps avec la même plaque neuve produisaient une violation d'unicité,
  // remontée à l'utilisateur sous le message trompeur « Un bon de livraison
  // avec ce numéro existe déjà ».
  const v = await db.vehicule.upsert({
    where: { immatriculation: cle },
    create: { immatriculation: cle, libelle, prestataireId: prestataireId ?? null },
    // Aucune mise à jour à la volée : réaffecter un camion à un transporteur est
    // une décision d'administration, pas un effet de bord d'une saisie de BL.
    update: {},
    select: { id: true, capaciteCiterneLitres: true, prestataireId: true, certificatJaugeageExpiration: true },
  });
  // Seul cas rattrapé : un camion encore rattaché à personne.
  if (!v.prestataireId && prestataireId) {
    await db.vehicule.update({ where: { id: v.id }, data: { prestataireId } });
  }
  return { id: v.id, capaciteCiterneLitres: v.capaciteCiterneLitres, certificatJaugeageExpiration: v.certificatJaugeageExpiration };
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

  // Pas de transporteur connu (BL saisi sans transporteur désigné) : plutôt que
  // de créer une seconde fiche pour la même personne, on rattache au chauffeur
  // homonyme existant s'il n'y en a qu'UN. Deux homonymes chez deux
  // transporteurs différents restent ambigus → nouvelle fiche, sans deviner.
  if (!pid) {
    const homonymes = await db.chauffeur.findMany({
      where: { nomNormalise: cle },
      select: { id: true, nom: true },
      take: 2,
    });
    if (homonymes.length === 1) return homonymes[0];
  }

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
