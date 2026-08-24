import { prisma } from '../config/database';
import { ConfigCuve, litresPourHauteur } from '../utils/cuve';

/**
 * Charge la configuration de conversion de la cuve d'un site (dimensions
 * internes + barémage). À passer ensuite à litresPourHauteur — une seule
 * lecture même pour plusieurs conversions (dépotage : avant ET après).
 */
export async function configCuveDuSite(siteId: string): Promise<ConfigCuve> {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: {
      formeCuve: true, cuveLongueurCm: true, cuveLargeurCm: true,
      cuveHauteurCm: true, cuveDiametreCm: true,
      baremage: { orderBy: { hauteurCm: 'asc' }, select: { hauteurCm: true, litres: true } },
    },
  });
  if (!site) return {};
  return {
    formeCuve: site.formeCuve,
    cuveLongueurCm: site.cuveLongueurCm != null ? Number(site.cuveLongueurCm) : null,
    cuveLargeurCm: site.cuveLargeurCm != null ? Number(site.cuveLargeurCm) : null,
    cuveHauteurCm: site.cuveHauteurCm != null ? Number(site.cuveHauteurCm) : null,
    cuveDiametreCm: site.cuveDiametreCm != null ? Number(site.cuveDiametreCm) : null,
    baremage: site.baremage.map((b) => ({ hauteurCm: Number(b.hauteurCm), litres: Number(b.litres) })),
  };
}

export { litresPourHauteur };
