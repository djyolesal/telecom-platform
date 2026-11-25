import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';

/**
 * Un plan de livraison ne reçoit que des sites À CUVE (capacité renseignée) : on
 * ne livre pas de gasoil là où rien ne peut le recevoir.
 *
 * `dejaAuPlan` : les sites déjà dans ce plan restent modifiables. Une cuve
 * effacée de la fiche ne doit pas bloquer un plan en cours de livraison.
 */
export async function exigerSitesACuve(siteIds: string[], dejaAuPlan: string[] = []): Promise<void> {
  const acquis = new Set(dejaAuPlan);
  const nouveaux = siteIds.filter((id) => !acquis.has(id));
  if (!nouveaux.length) return;
  const sites = await prisma.site.findMany({
    where: { id: { in: nouveaux }, cuveVolumeLitres: { gt: 0 } },
    select: { id: true },
  });
  const aCuve = new Set(sites.map((s) => s.id));
  const refuses = nouveaux.filter((id) => !aCuve.has(id));
  if (!refuses.length) return;
  const noms = await prisma.site.findMany({ where: { id: { in: refuses } }, select: { nom: true }, orderBy: { nom: 'asc' } });
  throw new AppError(
    noms.length
      ? `Site sans cuve renseignée : ${noms.map((s) => s.nom).join(', ')}. Retirez-le du plan ou complétez la capacité de la cuve sur sa fiche.`
      : 'Site du plan introuvable.',
    422
  );
}

/** Tolérance d'arrondi (litres) pour le contrôle « Σ lignes = volume à bord ». */
export const TOLERANCE_L = 0.5;

const n = (v: unknown): number => { const x = v == null ? 0 : Number(v); return Number.isFinite(x) ? x : 0; };

/**
 * Reste reçu d'AUTRES chargements : il s'ajoute au volume chargé pour donner ce
 * qui est réellement à bord. Le plan et la cohérence se mesurent là-dessus, sinon
 * un camion qui reprend le reste d'un autre est jugé sur un volume qu'il n'a pas.
 */
export async function volumeRecuBl(blId: string): Promise<number> {
  const r = await prisma.bonLivraison.aggregate({
    where: { reportSurBlId: blId },
    _sum: { resteReportLitres: true },
  });
  return n(r._sum.resteReportLitres);
}

/**
 * Valide le plan : Σ lignes = volume À BORD (chargé + reste reçu d'autres
 * camions), et alerte si le volume CHARGÉ dépasse le mois du BC. Le reste reçu
 * est déjà compté dans le chargement d'origine : l'inclure ici annonçait un
 * dépassement qui n'existe pas.
 */
export async function validatePlan(
  bonCommandeId: string,
  mois: number,
  volumeCharge: number,
  lignes: { volumePrevuLitres: number }[],
  ignoreBlId?: string,
  volumeRecu = 0
): Promise<{ warnings: string[] }> {
  const sommeLignes = lignes.reduce((s, l) => s + l.volumePrevuLitres, 0);
  const aBord = volumeCharge + volumeRecu;
  if (lignes.length > 0 && Math.abs(sommeLignes - aBord) > TOLERANCE_L) {
    throw new AppError(
      volumeRecu > 0
        ? `Le total du plan (${sommeLignes} L) doit être égal au volume à bord (${aBord} L : ${volumeCharge} L chargés + ${volumeRecu} L reçus d'un autre camion).`
        : `Le total du plan (${sommeLignes} L) doit être égal au volume chargé du camion (${volumeCharge} L).`,
      400
    );
  }
  const warnings: string[] = [];
  // Contrôle « respect du volume mensuel du BC ».
  const vm = await prisma.volumeMensuel.findUnique({
    where: { bonCommandeId_mois: { bonCommandeId, mois } },
  });
  if (!vm) {
    warnings.push(`Aucun volume prévu pour le mois ${mois} dans ce bon de commande.`);
  } else {
    const autres = await prisma.bonLivraison.aggregate({
      _sum: { volumeChargeLitres: true },
      where: {
        bonCommandeId,
        mois,
        statut: { not: 'ANNULE' },
        isBrouillon: false, // un brouillon n'est pas un chargement réel
        ...(ignoreBlId ? { id: { not: ignoreBlId } } : {}),
      },
    });
    const cumul = n(autres._sum.volumeChargeLitres) + volumeCharge;
    if (cumul > n(vm.volumePrevuLitres) + TOLERANCE_L) {
      warnings.push(
        `Dépassement du volume mensuel : ${cumul} L chargés pour le mois ${mois} contre ${n(vm.volumePrevuLitres)} L prévus au bon de commande.`
      );
    }
  }
  return { warnings };
}
