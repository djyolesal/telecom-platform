import { prisma } from '../config/database';
import { logger } from '../utils/logger';
import { getNum } from '../services/settings.service';
import { statObject } from '../services/storage.service';
import { photoAllegee, cleVignette } from '../services/vignettes.service';

/**
 * PRÉPARATION NOCTURNE DES VIGNETTES du rapport mensuel d'activité.
 *
 * Depuis le correctif, chaque photo reçoit sa vignette à son téléversement.
 * Restent les photos ANTÉRIEURES : sans elles, la première édition d'un mois
 * passé recalcule des centaines d'images d'un coup - c'est exactement ce qui
 * faisait expirer la requête.
 *
 * Le job travaille par BUDGET, pas jusqu'au bout : un plafond de photos par
 * nuit (réglable) et un budget de temps. Le conteneur est limité à 1 Go et
 * partage son CPU avec l'API ; mieux vaut rattraper l'arriéré en plusieurs
 * nuits que saturer le serveur pendant une heure.
 *
 * Les plus RÉCENTES d'abord : ce sont les mois qu'on édite.
 */
export async function vignettesJob(): Promise<void> {
  const plafond = getNum('vignettes.maxParNuit', 400);
  const budgetMs = Math.max(1, getNum('vignettes.budgetMinutes', 20)) * 60_000;
  if (plafond <= 0) {
    logger.info('[vignettes] désactivé (vignettes.maxParNuit = 0).');
    return;
  }

  const t0 = Date.now();
  let examinees = 0;
  let creees = 0;
  let dejaLa = 0;
  let echecs = 0;

  // Parcours par pages : la table des photos se compte en dizaines de milliers,
  // la charger d'un bloc dans un conteneur de 1 Go serait imprudent.
  const TAILLE_PAGE = 200;
  let curseur: string | undefined;
  while (creees < plafond && Date.now() - t0 < budgetMs) {
    const lot = await prisma.photo.findMany({
      where: { minioKey: { startsWith: 'photos/' } },
      select: { id: true, minioKey: true },
      orderBy: { createdAt: 'desc' },
      take: TAILLE_PAGE,
      ...(curseur ? { skip: 1, cursor: { id: curseur } } : {}),
    });
    if (!lot.length) break;
    curseur = lot[lot.length - 1].id;

    for (const photo of lot) {
      if (creees >= plafond || Date.now() - t0 >= budgetMs) break;
      examinees++;
      try {
        // HEAD plutôt que lecture : savoir si la vignette existe ne coûte rien.
        await statObject(cleVignette(photo.minioKey));
        dejaLa++;
        continue;
      } catch { /* absente : à fabriquer */ }
      try {
        const faite = await photoAllegee(photo.minioKey);
        if (faite) creees++; else echecs++;
      } catch {
        echecs++;
      }
    }
  }

  const secondes = Math.round((Date.now() - t0) / 1000);
  logger.info(
    `[vignettes] ${creees} créée(s), ${dejaLa} déjà présente(s), ${echecs} échec(s) `
    + `sur ${examinees} photo(s) examinée(s) en ${secondes}s.`
  );
}
