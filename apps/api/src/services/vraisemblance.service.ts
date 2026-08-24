import { prisma } from '../config/database';
import { getNum } from './settings.service';
import { configCuveDuSite } from './cuve.service';

/**
 * Contrôles de vraisemblance des saisies terrain (relevés énergie, dépotages).
 *
 * Philosophie : on ne BLOQUE pas — une valeur inhabituelle peut être légitime
 * (remplacement de compteur, cuve agrandie…). On détecte, on demande une
 * confirmation explicite au technicien, et la confirmation est tracée
 * (observations + journal d'audit) pour la supervision.
 */

export interface AvertissementSaisie {
  champ: string;
  message: string;
}

const fmtDate = (d: Date) => d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtNum = (n: number) => Number(n.toFixed(1)).toLocaleString('fr-FR');

/** Jours écoulés (fraction) entre deux dates, jamais négatif. */
const joursEntre = (avant: Date, apres: Date) => Math.max(0, (apres.getTime() - avant.getTime()) / 86_400_000);

interface SiteCloture {
  id: string;
  cuveVolumeLitres: unknown; // Prisma Decimal | null
  groupes: { id: string; numero: number }[];
}

/**
 * Vérifie les relevés énergie saisis à la clôture d'une maintenance.
 * `e` est le bloc `energie` du corps de requête (déjà validé « champs requis »).
 */
export async function verifierClotureEnergie(
  site: SiteCloture,
  e: Record<string, unknown>,
  sources: string[],
  maintenanceId: string
): Promise<AvertissementSaisie[]> {
  const avertissements: AvertissementSaisie[] = [];
  const num = (v: unknown): number | null => (v == null || v === '' ? null : Number(v));
  const maintenant = new Date();
  const margeCuvePct = getNum('vraisemblance.margeCuvePct', 2);
  const maxHeuresJour = getNum('vraisemblance.maxHeuresGEParJour', 24);
  const maxKwhJour = getNum('vraisemblance.maxKwhParJour', 1000);

  if (sources.includes('GE')) {
    // 1) Jauge cuve : ne peut pas dépasser la capacité de la cuve du site.
    const jauge = num(e.volumeGasoilLitres);
    const cuve = site.cuveVolumeLitres != null ? Number(site.cuveVolumeLitres) : null;
    if (jauge != null && cuve != null && cuve > 0 && jauge > cuve * (1 + margeCuvePct / 100)) {
      avertissements.push({
        champ: 'volumeGasoilLitres',
        message: `Volume gasoil saisi (${fmtNum(jauge)} L) supérieur à la capacité de la cuve du site (${fmtNum(cuve)} L).`,
      });
    }

    // 2) Index horaire GE : jamais décroissant, et un GE ne tourne pas plus de
    //    maxHeuresJour h par jour écoulé depuis le dernier relevé.
    const geHours = (e.geHours ?? {}) as Record<string, unknown>;
    const cibles = site.groupes.length
      ? site.groupes.map((g) => ({ groupeId: g.id as string | null, numero: g.numero, saisi: num(geHours[g.id]) }))
      : [{ groupeId: null as string | null, numero: 1, saisi: num(e.indexHeuresGE) }];
    for (const c of cibles) {
      if (c.saisi == null) continue;
      const prev = await prisma.releveEnergie.findFirst({
        where: {
          siteId: site.id, source: 'GE', indexHeuresGE: { not: null },
          maintenanceId: { not: maintenanceId },
          ...(c.groupeId ? { groupeId: c.groupeId } : {}),
        },
        orderBy: { dateReleve: 'desc' },
        select: { indexHeuresGE: true, dateReleve: true },
      });
      if (prev?.indexHeuresGE == null) continue;
      const dernier = Number(prev.indexHeuresGE);
      const libGE = site.groupes.length > 1 ? `GE n°${c.numero}` : 'GE';
      if (c.saisi < dernier) {
        avertissements.push({
          champ: 'indexHeuresGE',
          message: `Index horaire ${libGE} saisi (${fmtNum(c.saisi)} h) inférieur au dernier index connu (${fmtNum(dernier)} h le ${fmtDate(prev.dateReleve)}) - un compteur horaire ne recule pas.`,
        });
      } else {
        const deltaMax = joursEntre(prev.dateReleve, maintenant) * maxHeuresJour + 1;
        if (c.saisi - dernier > deltaMax) {
          avertissements.push({
            champ: 'indexHeuresGE',
            message: `Index horaire ${libGE} : bond de ${fmtNum(c.saisi - dernier)} h depuis le dernier relevé (${fmtNum(dernier)} h le ${fmtDate(prev.dateReleve)}), alors que ${fmtNum(deltaMax)} h au maximum ont pu s'écouler.`,
          });
        }
      }
    }
  }

  if (sources.includes('CEET')) {
    // 3) Index compteur CEET : cumulé donc jamais décroissant, delta plausible.
    const saisi = num(e.indexCompteur);
    if (saisi != null) {
      const prev = await prisma.releveEnergie.findFirst({
        where: { siteId: site.id, source: 'CEET', indexCompteur: { not: null }, maintenanceId: { not: maintenanceId } },
        orderBy: { dateReleve: 'desc' },
        select: { indexCompteur: true, dateReleve: true },
      });
      if (prev?.indexCompteur != null) {
        const dernier = Number(prev.indexCompteur);
        if (saisi < dernier) {
          avertissements.push({
            champ: 'indexCompteur',
            message: `Index compteur CEET saisi (${fmtNum(saisi)} kWh) inférieur au dernier index connu (${fmtNum(dernier)} kWh le ${fmtDate(prev.dateReleve)}) - un index cumulé ne recule pas (sauf remplacement du compteur).`,
          });
        } else {
          const deltaMax = (joursEntre(prev.dateReleve, maintenant) + 1) * maxKwhJour;
          if (saisi - dernier > deltaMax) {
            avertissements.push({
              champ: 'indexCompteur',
              message: `Consommation CEET de ${fmtNum(saisi - dernier)} kWh depuis le dernier relevé (${fmtDate(prev.dateReleve)}) - très au-dessus du plausible (~${fmtNum(maxKwhJour)} kWh/jour max).`,
            });
          }
        }
      }
    }
  }

  return avertissements;
}

/** Vérifie les niveaux saisis pour un dépotage (stocks vs capacité de cuve et dernier niveau connu). */
export async function verifierDepotage(
  siteId: string,
  valeurs: { stockAvant: number | null; stockApres: number | null; volume: number }
): Promise<AvertissementSaisie[]> {
  const avertissements: AvertissementSaisie[] = [];
  const margeCuvePct = getNum('vraisemblance.margeCuvePct', 2);
  const margeStockL = getNum('vraisemblance.margeStockLitres', 100);

  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { cuveVolumeLitres: true } });
  const cuve = site?.cuveVolumeLitres != null ? Number(site.cuveVolumeLitres) : null;
  const plafond = cuve != null && cuve > 0 ? cuve * (1 + margeCuvePct / 100) : null;

  if (plafond != null) {
    if (valeurs.stockAvant != null && valeurs.stockAvant > plafond) {
      avertissements.push({
        champ: 'stockAvantLitres',
        message: `Stock avant dépotage (${fmtNum(valeurs.stockAvant)} L) supérieur à la capacité de la cuve du site (${fmtNum(cuve!)} L).`,
      });
    }
    if (valeurs.stockApres != null && valeurs.stockApres > plafond) {
      avertissements.push({
        champ: 'stockApresLitres',
        message: `Stock après dépotage (${fmtNum(valeurs.stockApres)} L) supérieur à la capacité de la cuve du site (${fmtNum(cuve!)} L).`,
      });
    }
  }

  // Stock avant vs dernier niveau connu : sans dépotage entre-temps, le niveau
  // ne peut qu'avoir baissé (consommation). Une hausse = erreur probable de saisie.
  if (valeurs.stockAvant != null) {
    const [releve, depot] = await Promise.all([
      prisma.releveEnergie.findFirst({
        where: { siteId, source: 'GE', volumeGasoilLitres: { not: null } },
        orderBy: { dateReleve: 'desc' },
        select: { volumeGasoilLitres: true, dateReleve: true },
      }),
      prisma.depotage.findFirst({
        where: { siteId, stockApresLitres: { not: null } },
        orderBy: { dateDepotage: 'desc' },
        select: { stockApresLitres: true, dateDepotage: true },
      }),
    ]);
    const candidats = [
      releve ? { valeur: Number(releve.volumeGasoilLitres), date: releve.dateReleve } : null,
      depot ? { valeur: Number(depot.stockApresLitres), date: depot.dateDepotage } : null,
    ].filter((x): x is { valeur: number; date: Date } => x != null);
    const dernier = candidats.sort((a, b) => b.date.getTime() - a.date.getTime())[0];
    if (dernier && valeurs.stockAvant > dernier.valeur + margeStockL) {
      avertissements.push({
        champ: 'stockAvantLitres',
        message: `Stock avant dépotage (${fmtNum(valeurs.stockAvant)} L) supérieur au dernier niveau connu (${fmtNum(dernier.valeur)} L le ${fmtDate(dernier.date)}) - sans dépotage entre-temps, le niveau ne peut qu'avoir baissé.`,
      });
    }
  }

  return avertissements;
}

/**
 * Dernières valeurs connues d'un site — envoyées au mobile avec le détail d'une
 * maintenance pour (a) afficher un repère sous chaque champ de saisie et
 * (b) pré-contrôler la vraisemblance AVANT mise en file hors-ligne.
 */
export async function contexteSaisieSite(siteId: string, groupeIds: string[]) {
  const [site, jauge, ceet, dernierDepotage, relevesGE] = await Promise.all([
    prisma.site.findUnique({ where: { id: siteId }, select: { cuveVolumeLitres: true } }),
    prisma.releveEnergie.findFirst({
      where: { siteId, source: 'GE', volumeGasoilLitres: { not: null } },
      orderBy: { dateReleve: 'desc' },
      select: { volumeGasoilLitres: true, dateReleve: true },
    }),
    prisma.releveEnergie.findFirst({
      where: { siteId, source: 'CEET', indexCompteur: { not: null } },
      orderBy: { dateReleve: 'desc' },
      select: { indexCompteur: true, dateReleve: true },
    }),
    prisma.depotage.findFirst({
      where: { siteId, stockApresLitres: { not: null } },
      orderBy: { dateDepotage: 'desc' },
      select: { stockApresLitres: true, dateDepotage: true },
    }),
    // Dernier index horaire par GE (ou mono-GE sans groupe).
    Promise.all(
      (groupeIds.length ? groupeIds : [null]).map(async (gid) => {
        const r = await prisma.releveEnergie.findFirst({
          where: { siteId, source: 'GE', indexHeuresGE: { not: null }, ...(gid ? { groupeId: gid } : {}) },
          orderBy: { dateReleve: 'desc' },
          select: { indexHeuresGE: true, dateReleve: true },
        });
        return { gid, r };
      })
    ),
  ]);

  const indexGE: Record<string, { valeur: number; date: string }> = {};
  let indexGEMono: { valeur: number; date: string } | null = null;
  for (const { gid, r } of relevesGE) {
    if (!r?.indexHeuresGE) continue;
    const item = { valeur: Number(r.indexHeuresGE), date: r.dateReleve.toISOString() };
    if (gid) indexGE[gid] = item;
    else indexGEMono = item;
  }

  // Niveau cuve de référence = le plus récent entre dernier relevé et dernier dépotage.
  const niveaux = [
    jauge ? { valeur: Number(jauge.volumeGasoilLitres), date: jauge.dateReleve } : null,
    dernierDepotage ? { valeur: Number(dernierDepotage.stockApresLitres), date: dernierDepotage.dateDepotage } : null,
  ].filter((x): x is { valeur: number; date: Date } => x != null);
  const niveau = niveaux.sort((a, b) => b.date.getTime() - a.date.getTime())[0] ?? null;

  return {
    cuveVolumeLitres: site?.cuveVolumeLitres != null ? Number(site.cuveVolumeLitres) : null,
    // Config de conversion hauteur → litres : embarquée dans le contexte de
    // saisie (donc dans le cache hors-ligne du mobile) pour que le formulaire
    // de clôture convertisse la hauteur mesurée sans réseau.
    cuve: await configCuveDuSite(siteId),
    dernierNiveauCuve: niveau ? { valeur: niveau.valeur, date: niveau.date.toISOString() } : null,
    dernierIndexCeet: ceet?.indexCompteur != null ? { valeur: Number(ceet.indexCompteur), date: ceet.dateReleve.toISOString() } : null,
    dernierIndexGE: indexGE,
    dernierIndexGEMono: indexGEMono,
    maxHeuresGEParJour: getNum('vraisemblance.maxHeuresGEParJour', 24),
    margeCuvePct: getNum('vraisemblance.margeCuvePct', 2),
  };
}

/** Ligne de traçabilité ajoutée aux observations quand le technicien confirme malgré avertissements. */
export function traceConfirmation(avertissements: AvertissementSaisie[]): string {
  return [
    '⚠ Valeurs inhabituelles confirmées par le technicien :',
    ...avertissements.map((a) => `— ${a.message}`),
  ].join('\n');
}
