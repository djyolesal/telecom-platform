import { prisma } from '../config/database';
import { minioClient, MINIO_BUCKET } from '../config/minio';
import { logger } from '../utils/logger';

/**
 * Ménage nocturne du stockage : supprime les objets MinIO ORPHELINS — plus
 * référencés par aucune ligne en base — et vieux d'au moins 7 jours.
 *
 * D'où viennent-ils : un fichier est archivé DÈS son envoi (analyse OCR d'un
 * BC/BL, logo, PDF joint), avant la validation du formulaire. « Annuler »,
 * fermer l'onglet ou perdre le réseau laisse donc l'objet en rade. Le délai de
 * 7 jours évite de supprimer un fichier dont le formulaire est encore ouvert.
 */

const AGE_MIN_JOURS = 7;

/**
 * Certaines colonnes historiques stockent une URL complète plutôt que la clé
 * nue : on ramène tout à la clé d'objet.
 */
export function cleDe(valeur: string | null | undefined): string | null {
  if (!valeur) return null;
  let v = valeur.trim();
  if (!v) return null;
  const sansQuery = v.split('?')[0];
  for (const marqueur of [`/storage/${MINIO_BUCKET}/`, '/api/v1/files/', '/files/']) {
    const i = sansQuery.indexOf(marqueur);
    if (i >= 0) {
      v = sansQuery.slice(i + marqueur.length);
      try { return decodeURIComponent(v); } catch { return v; }
    }
  }
  return sansQuery.replace(/^\/+/, '');
}

/** Toutes les clés d'objets référencées quelque part en base. */
async function clesReferencees(): Promise<Set<string>> {
  const refs = new Set<string>();
  const ajouter = (...valeurs: Array<string | null | undefined>) => {
    for (const v of valeurs) {
      const cle = cleDe(v);
      if (cle) refs.add(cle);
    }
  };

  const [photos, maintenances, depotages, incidents, prestataires, bcs, bls] = await Promise.all([
    prisma.photo.findMany({ select: { minioKey: true, url: true } }),
    prisma.maintenance.findMany({
      where: { OR: [{ signaturePath: { not: null } }, { rapportPdfPath: { not: null } }] },
      select: { signaturePath: true, rapportPdfPath: true },
    }),
    prisma.depotage.findMany({
      select: {
        signaturePath: true, bonLivraisonPath: true,
        signatureChauffeurPath: true, signatureAgentSecuritePath: true, signatureTechnicienPath: true,
      },
    }),
    prisma.incident.findMany({ where: { signaturePath: { not: null } }, select: { signaturePath: true } }),
    prisma.prestataire.findMany({ where: { logoPath: { not: null } }, select: { logoPath: true } }),
    prisma.bonCommande.findMany({ where: { bcPdfPath: { not: null } }, select: { bcPdfPath: true } }),
    prisma.bonLivraison.findMany({
      where: { OR: [{ blPdfPath: { not: null } }, { bordereauPdfPath: { not: null } }] },
      select: { blPdfPath: true, bordereauPdfPath: true },
    }),
  ]);

  for (const p of photos) ajouter(p.minioKey, p.url);
  for (const m of maintenances) ajouter(m.signaturePath, m.rapportPdfPath);
  for (const d of depotages) {
    ajouter(d.signaturePath, d.bonLivraisonPath, d.signatureChauffeurPath, d.signatureAgentSecuritePath, d.signatureTechnicienPath);
  }
  for (const i of incidents) ajouter(i.signaturePath);
  for (const p of prestataires) ajouter(p.logoPath);
  for (const b of bcs) ajouter(b.bcPdfPath);
  for (const b of bls) ajouter(b.blPdfPath, b.bordereauPdfPath);
  return refs;
}

interface ObjetOrphelin { name: string; size: number }

/**
 * Parcourt le bucket EN FLUX : ne matérialise que les orphelins (liste courte,
 * bornée) et compte le total au passage — au lieu de charger tout l'inventaire
 * en mémoire à côté du recensement des références (conteneur 1 Go, job à 4h30).
 */
function scannerOrphelins(refs: Set<string>, seuilMs: number): Promise<{ orphelins: ObjetOrphelin[]; total: number }> {
  return new Promise((resolve, reject) => {
    const orphelins: ObjetOrphelin[] = [];
    let total = 0;
    const flux = minioClient.listObjectsV2(MINIO_BUCKET, '', true);
    flux.on('data', (o) => {
      if (!o.name || !o.lastModified) return;
      total++;
      if (!refs.has(o.name) && o.lastModified.getTime() < seuilMs) {
        orphelins.push({ name: o.name, size: o.size ?? 0 });
      }
    });
    flux.on('error', reject);
    flux.on('end', () => resolve({ orphelins, total }));
  });
}

export async function purgeOrphelinsJob(): Promise<void> {
  const refs = await clesReferencees();
  const seuil = Date.now() - AGE_MIN_JOURS * 86_400_000;
  const { orphelins, total } = await scannerOrphelins(refs, seuil);

  if (!orphelins.length) {
    logger.info(`[purge-orphelins] Rien à faire (${total} objets, tous référencés ou récents).`);
    return;
  }

  // Garde-fou : si plus de la moitié du bucket partait d'un coup, c'est
  // vraisemblablement le recensement des références qui a un trou (nouveau
  // champ non listé ici, par exemple) — on n'efface rien et on alerte.
  if (total >= 100 && orphelins.length / total > 0.5) {
    logger.error(
      `[purge-orphelins] ANNULÉ : ${orphelins.length}/${total} objets seraient supprimés (>50 %). ` +
      `Vérifier que clesReferencees() couvre bien tous les champs de chemins.`
    );
    return;
  }

  const totalMo = orphelins.reduce((s, o) => s + o.size, 0) / 1_048_576;
  for (let i = 0; i < orphelins.length; i += 200) {
    await minioClient.removeObjects(MINIO_BUCKET, orphelins.slice(i, i + 200).map((o) => o.name));
  }
  logger.info(
    `[purge-orphelins] ${orphelins.length} objet(s) orphelin(s) supprimé(s) (${totalMo.toFixed(1)} Mo) - ` +
    `${total - orphelins.length} objets conservés.`
  );
}
