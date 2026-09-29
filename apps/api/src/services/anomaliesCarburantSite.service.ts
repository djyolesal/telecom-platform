import { prisma } from '../config/database';
import { CodeAnomalie } from './vraisemblance.service';

/**
 * ANOMALIES DE SAISIE QUI TOUCHENT LE CARBURANT, par site.
 *
 * Depuis le contrôle de vraisemblance, un relevé invraisemblable est une
 * DONNÉE : cuve dépassée, index GE reculé, dépotage en doublon. Mais les
 * calculs carburant - stock courant, bilan sur période, bilan mensuel - le
 * lisaient sans le savoir : un relevé signalé pesait exactement autant qu'un
 * relevé sain dans le stock publié, et dans la contre-épreuve vol/fuite qui en
 * découle.
 *
 * Ce service ne CORRIGE rien et n'écarte rien : écarter une mesure est une
 * décision d'exploitation, pas un effet de bord d'un rapport. Il rend
 * seulement visible, sur chaque ligne de site, qu'une saisie en attente de
 * vérification alimente le chiffre affiché - pour qu'on sache lequel croire.
 */

/** Codes de vraisemblance qui pèsent sur un volume ou une conso de gasoil. */
// Typé sur CodeAnomalie : renommer un code casse la compilation ici plutôt que
// de vider silencieusement le signal sur les écrans carburant.
export const CODES_CARBURANT: CodeAnomalie[] = [
  'CUVE_DEPASSEE',      // niveau saisi au-dessus de la capacité : la jauge ment
  'STOCK_AVANT_CUVE',   // stock avant dépotage au-dessus de la cuve
  'STOCK_APRES_CUVE',   // stock après dépotage au-dessus de la cuve
  'STOCK_AVANT_HAUSSE', // le stock monte sans livraison
  'DEPOTAGE_DOUBLON',   // livraison comptée deux fois
  'INDEX_GE_RECULE',    // l'index d'heures recule : la contre-épreuve perd son socle
  'HEURES_GE_ABERRANTES',
];

export interface AnomaliesSite {
  nb: number;
  codes: string[];
}

/**
 * Anomalies ENCORE À VÉRIFIER par site, sur une fenêtre.
 *
 * Les anomalies justifiées ou déjà corrigées ne remontent pas : elles ont été
 * tranchées, les rappeler transformerait l'écran en bruit permanent.
 */
export async function anomaliesCarburantParSite(opts: {
  siteIds?: string[];
  depuis?: Date;
  jusqua?: Date;
} = {}): Promise<Map<string, AnomaliesSite>> {
  const lignes = await prisma.anomalieSaisie.groupBy({
    by: ['siteId', 'code'],
    where: {
      statut: 'A_VERIFIER',
      code: { in: CODES_CARBURANT },
      ...(opts.siteIds ? { siteId: { in: opts.siteIds } } : {}),
      ...(opts.depuis || opts.jusqua
        ? { createdAt: { ...(opts.depuis ? { gte: opts.depuis } : {}), ...(opts.jusqua ? { lt: opts.jusqua } : {}) } }
        : {}),
    },
    _count: { _all: true },
  });

  const out = new Map<string, AnomaliesSite>();
  for (const l of lignes) {
    const cur = out.get(l.siteId) ?? { nb: 0, codes: [] };
    cur.nb += l._count._all;
    if (!cur.codes.includes(l.code)) cur.codes.push(l.code);
    out.set(l.siteId, cur);
  }
  for (const v of out.values()) v.codes.sort();
  return out;
}
