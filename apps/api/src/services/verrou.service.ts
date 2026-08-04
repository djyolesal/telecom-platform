import { Prisma } from '@prisma/client';

/**
 * Verrou consultatif par site (auto-libéré en fin de transaction) : sérialise
 * les écritures carburant d'un MÊME site — dépotages, clôtures de maintenance,
 * transferts et purges — pour qu'elles ne lisent pas toutes le même « dépotage
 * précédent » et ne comptent pas deux fois la consommation. N'affecte pas les
 * autres sites (la clé dérive du siteId).
 *
 * Extrait du contrôleur des dépotages parce que les mouvements de carburant
 * (transfert, purge) modifient eux aussi le stock d'un site : sans partager ce
 * verrou, un transfert concurrent d'un dépotage rouvrait exactement la course
 * que ce verrou avait fermée.
 */
export async function verrouSiteCarburant(tx: Prisma.TransactionClient, siteId: string): Promise<void> {
  // $executeRaw : le retour `void` du verrou n'est pas désérialisable par $queryRaw.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'carb:' + siteId})::bigint)`;
}
