import { prisma } from '../config/database';
import { minioClient, MINIO_BUCKET } from '../config/minio';
import { logger } from '../utils/logger';
import { PREFIXE_VIGNETTE, cleVignette } from '../services/vignettes.service';

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

/**
 * TOUTES les colonnes qui portent une clé (ou une URL) d'objet MinIO.
 *
 * Un champ oublié ici voit ses fichiers effacés 7 jours après l'envoi, sans
 * bruit : de août à novembre 2026, certificats de jaugeage des camions,
 * pièces et signatures des mouvements, bons de retour, signatures d'agent de
 * sécurité, rapports mensuels archivés et logo client ont disparu ainsi.
 * Le test `purge-orphelins.test.ts` compare cette liste au schéma Prisma :
 * une nouvelle colonne `...Path` / `...MinioKey` non déclarée le fait échouer.
 */
export const CHAMPS_FICHIERS: Record<string, string[]> = {
  photo: ['minioKey', 'url'],
  maintenance: ['signaturePath', 'signatureAgentSecuritePath', 'rapportPdfPath'],
  depotage: ['signaturePath', 'bonLivraisonPath', 'signatureChauffeurPath', 'signatureAgentSecuritePath', 'signatureTechnicienPath'],
  incident: ['signaturePath', 'signatureAgentSecuritePath'],
  prestataire: ['logoPath'],
  mouvementCarburant: ['documentPath', 'signaturePath'],
  vehicule: ['certificatJaugeagePath'],
  bonCommande: ['bcPdfPath'],
  bonLivraison: ['blPdfPath', 'bordereauPdfPath', 'bonRetourPath'],
  rapportMensuel: ['minioKey', 'ficheMinioKey'],
};

/** Paramètres (system_settings) dont la valeur est une clé d'objet. */
export const PARAMETRES_FICHIERS = ['client.logoKey'];

type Delegue = { findMany(args: unknown): Promise<Array<Record<string, unknown>>> };

/** Toutes les clés d'objets référencées quelque part en base. */
export async function clesReferencees(): Promise<Set<string>> {
  const refs = new Set<string>();
  const ajouter = (v: unknown) => {
    const cle = typeof v === 'string' ? cleDe(v) : null;
    if (!cle) return;
    refs.add(cle);
    // La vignette d'une photo (cache du rapport mensuel d'activité) vit
    // aussi longtemps que son original : sans cette ligne, le ménage
    // nocturne effaçait un cache que le rapport suivant devait recalculer.
    if (!cle.startsWith(PREFIXE_VIGNETTE)) refs.add(cleVignette(cle));
  };

  const lignes = await Promise.all(Object.entries(CHAMPS_FICHIERS).map(([modele, champs]) => {
    const delegue = (prisma as unknown as Record<string, Delegue>)[modele];
    // Pas de filtre `not: null` : Prisma le refuse sur une colonne obligatoire
    // (photo.url, rapportMensuel.minioKey) ; les vides sont ignorés par cleDe.
    return delegue.findMany({ select: Object.fromEntries(champs.map((c) => [c, true])) }).then((rs) => rs.map((r) => champs.map((c) => r[c])));
  }));
  for (const parModele of lignes) for (const valeurs of parModele) valeurs.forEach(ajouter);

  const parametres = await prisma.systemSettings.findMany({ where: { key: { in: PARAMETRES_FICHIERS } } });
  for (const p of parametres) ajouter(p.value);
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
