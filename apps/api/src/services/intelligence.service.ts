import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { forecastSites, suggestTournees, SiteForecast } from './replenishment.service';
import { computeManquants } from './manquants.service';
import { getNum } from './settings.service';

type ManquantsResult = Awaited<ReturnType<typeof computeManquants>>;

export interface AnomalieConso {
  siteId: string; code: string; nom: string; region: string;
  consoReelleJour: number; consoTheoriqueJour: number; ecartPct: number;
  type: 'SURCONSOMMATION' | 'SOUSCONSOMMATION';
  tendance: 'HAUSSE' | 'STABLE' | 'BAISSE';
  manquantAssocie: boolean; // le site figure aussi dans les manquants → risque renforcé
  severite: 'ELEVEE' | 'MOYENNE';
}

/**
 * Détection d'anomalie de consommation : compare la consommation réelle (relevés)
 * à la consommation théorique (config GE). Un écart fort signale fuite / vol /
 * heures sous- ou sur-déclarées. Croisé avec les manquants pour pondérer le risque.
 */
export async function detectAnomalies(opts: { region?: string; sitesAll?: SiteForecast[]; manquants?: ManquantsResult } = {}): Promise<AnomalieConso[]> {
  const seuil = getNum('maintenance.seuilEcartGasoilPct', env.SEUIL_ECART_GASOIL_PCT) / 100;
  // Réutilise les calculs déjà faits par l'appelant si fournis (évite les scans redondants).
  const [sites, manquants] = await Promise.all([
    opts.sitesAll ?? forecastSites({ region: opts.region, all: true }),
    opts.manquants ?? computeManquants({ region: opts.region }),
  ]);
  const sitesManquants = new Set(manquants.lignesEnRetard.map((l) => l.siteCode));

  const out: AnomalieConso[] = [];
  for (const s of sites) {
    if (s.source !== 'historique' || s.consoTheoriqueJour <= 0) continue;
    const ratio = s.consoJour / s.consoTheoriqueJour;
    const type: AnomalieConso['type'] | null =
      ratio > 1 + seuil ? 'SURCONSOMMATION' : ratio < 1 - seuil ? 'SOUSCONSOMMATION' : null;
    if (!type) continue;
    const manquantAssocie = sitesManquants.has(s.code);
    // Surconsommation + manquant = signal de vol/fuite le plus fort.
    const severite: AnomalieConso['severite'] =
      type === 'SURCONSOMMATION' && (manquantAssocie || ratio > 1 + seuil * 2) ? 'ELEVEE' : 'MOYENNE';
    out.push({
      siteId: s.siteId, code: s.code, nom: s.nom, region: s.region,
      consoReelleJour: s.consoJour, consoTheoriqueJour: s.consoTheoriqueJour,
      ecartPct: Math.round((ratio - 1) * 100),
      type, tendance: s.tendance, manquantAssocie, severite,
    });
  }
  return out.sort((a, b) => Math.abs(b.ecartPct) - Math.abs(a.ecartPct));
}

const L = (v: number) => `${Math.round(v).toLocaleString('fr-FR')} L`;

/** Construit le briefing déterministe (sert de repli ET de contexte pour Claude). */
function buildBriefing(sites: SiteForecast[], tournees: ReturnType<typeof suggestTournees>, anomalies: AnomalieConso[], manquantsTotaux: { manquantSitesLitres: number; nbSitesManquants: number }) {
  const critiques = sites.filter((s) => s.priorite === 'CRITIQUE');
  const volume = sites.reduce((s, x) => s + x.quantiteRecommandee, 0);
  const km = Math.round(tournees.reduce((s, t) => s + t.distanceKm, 0));
  return {
    nbSites: sites.length,
    nbCritiques: critiques.length,
    volumeRecommande: volume,
    nbTournees: tournees.length,
    totalKm: km,
    topSites: sites.slice(0, 8).map((s) => ({ code: s.code, region: s.region, autonomieJours: s.autonomieJours, quantite: s.quantiteRecommandee, priorite: s.priorite, tendance: s.tendance })),
    anomalies: anomalies.slice(0, 8).map((a) => ({ code: a.code, type: a.type, ecartPct: a.ecartPct, severite: a.severite, manquantAssocie: a.manquantAssocie })),
    manquants: manquantsTotaux,
  };
}

/** Synthèse déterministe (repli si la clé Claude est absente ou l'appel échoue). */
function fallbackSynthese(b: ReturnType<typeof buildBriefing>): string {
  const lignes: string[] = [];
  lignes.push(`${b.nbSites} site(s) à réapprovisionner sur l'horizon, dont ${b.nbCritiques} critique(s), pour ${L(b.volumeRecommande)} au total.`);
  lignes.push(`${b.nbTournees} tournée(s) suggérée(s) (≈ ${b.totalKm.toLocaleString('fr-FR')} km).`);
  if (b.topSites.length) {
    lignes.push('Priorités : ' + b.topSites.filter((s) => s.priorite !== 'A_PLANIFIER').slice(0, 5).map((s) => `${s.code} (${s.autonomieJours} j, ${L(s.quantite)})`).join(', ') + '.');
  }
  if (b.anomalies.length) {
    lignes.push(`⚠ ${b.anomalies.length} anomalie(s) de consommation : ` + b.anomalies.slice(0, 5).map((a) => `${a.code} ${a.type === 'SURCONSOMMATION' ? '+' : ''}${a.ecartPct}%${a.manquantAssocie ? ' (manquant associé)' : ''}`).join(', ') + '. À vérifier : fuite, vol, ou heures GE mal déclarées.');
  }
  if (b.manquants.nbSitesManquants > 0) {
    lignes.push(`Manquants en cours : ${b.manquants.nbSitesManquants} site(s) pour ${L(b.manquants.manquantSitesLitres)}.`);
  }
  return lignes.join('\n');
}

/**
 * Synthèse en langage naturel des recommandations d'appro pour le manager.
 * Utilise Claude (claude-opus-4-8, pensée adaptative) si une clé API est
 * configurée ; sinon un résumé déterministe équivalent.
 */
export async function generateSynthese(opts: { region?: string } = {}): Promise<{ texte: string; source: 'claude' | 'deterministe' }> {
  // Calculs lourds mutualisés : forecast complet + manquants une seule fois.
  const horizon = getNum('appro.horizonJours', env.APPRO_HORIZON_JOURS);
  const [sitesAll, manquants] = await Promise.all([
    forecastSites({ region: opts.region, all: true }),
    computeManquants({ region: opts.region }),
  ]);
  const due = sitesAll.filter((s) => s.autonomieJours != null && s.autonomieJours <= horizon);
  const anomalies = await detectAnomalies({ region: opts.region, sitesAll, manquants });
  const tournees = suggestTournees(due);
  const briefing = buildBriefing(due, tournees, anomalies, manquants.totaux);

  if (!env.ANTHROPIC_API_KEY) {
    return { texte: fallbackSynthese(briefing), source: 'deterministe' };
  }

  try {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      thinking: { type: 'adaptive' },
      system:
        "Tu es l'assistant logistique carburant d'un opérateur télécom en Afrique de l'Ouest (parc de sites BTS alimentés par groupes électrogènes). " +
        "À partir des données chiffrées fournies (prévisions de rupture, tournées suggérées, anomalies de consommation, manquants), rédige une synthèse opérationnelle pour le manager, en français, claire et actionnable. " +
        "Structure courte : 1) priorités de livraison, 2) anomalies à investiguer (fuite/vol probable si surconsommation + manquant), 3) recommandation de tournées. " +
        "Sois factuel, cite les codes sites et les volumes. N'invente aucune donnée absente du briefing. 150 mots maximum.",
      messages: [{ role: 'user', content: `Briefing du jour (JSON) :\n${JSON.stringify(briefing)}` }],
    });
    const texte = response.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n').trim();
    return { texte: texte || fallbackSynthese(briefing), source: 'claude' };
  } catch (e) {
    logger.warn('[synthese] appel Claude échoué, repli déterministe:', e);
    return { texte: fallbackSynthese(briefing), source: 'deterministe' };
  }
}
