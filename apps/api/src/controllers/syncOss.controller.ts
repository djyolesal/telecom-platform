import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';

/**
 * SYNCHRONISATION OSS — détection automatique des coupures « site entier ».
 *
 * Un collecteur (cron sur une machine du réseau Moov) exécute la commande
 * d'état des eNodeB sur le nœud OSS et POSTe la sortie BRUTE ici. On parse
 * chaque ligne « …Macro-<nodeId> | <name> connected|disconnected <date> » :
 *   - disconnected → coupure SITE ouverte (source OSS), datée de la coupure ;
 *   - connected    → clôture de la coupure OSS ouverte, datée du rétablissement
 *     (la colonne date d'une ligne connected EST l'heure de reconnexion).
 *
 * MODE OBSERVATION (arrêté avec l'exploitant) : pas d'incident, pas de SMS,
 * pas de propagation aval — les coupures OSS s'affichent (listes, carte NOC)
 * mais restent silencieuses jusqu'à validation du rapprochement. L'armement
 * des notifications sera un second temps, avec anti-rebond.
 *
 * Auth : jeton MACHINE dédié (env OSS_SYNC_TOKEN) — pas un compte utilisateur.
 * L'auto-clôture ne touche JAMAIS une coupure saisie par un humain.
 */

interface LigneOss {
  nodeId: string;
  name: string;
  etat: 'connected' | 'disconnected';
  quand: Date;
}

/** Parse la sortie brute de la commande OSS (lignes non conformes ignorées). */
export function parserSortieOss(texte: string): LigneOss[] {
  const lignes: LigneOss[] = [];
  const re = /Macro-(\d+)\s+\|\s+(\S+)\s+(connected|disconnected)\s+(\d{4}-\d{2}-\d{2}),(\d{2}:\d{2}:\d{2})/;
  for (const brut of texte.split('\n')) {
    const m = brut.match(re);
    if (!m) continue;
    // Heure NOC = Africa/Lome = UTC+0 : interprétée telle quelle en UTC.
    const quand = new Date(`${m[4]}T${m[5]}.000Z`);
    if (Number.isNaN(quand.getTime())) continue;
    lignes.push({ nodeId: m[1], name: m[2], etat: m[3] as LigneOss['etat'], quand });
  }
  return lignes;
}

/** Normalise un nom pour le rapprochement (majuscules, sans espaces/tirets). */
const normaliser = (s: string) => s.toUpperCase().replace(/[\s\-_]/g, '');

export async function syncOss(req: Request, res: Response, next: NextFunction) {
  try {
    const token = process.env.OSS_SYNC_TOKEN;
    if (!token) throw new AppError('Synchronisation OSS non configurée (OSS_SYNC_TOKEN absent)', 503);
    const recu = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (recu !== token) throw new AppError('Jeton de synchronisation invalide', 401);

    const texte = typeof req.body === 'string' ? req.body : String(req.body ?? '');
    const lignes = parserSortieOss(texte);
    if (!lignes.length) throw new AppError('Aucune ligne eNodeB reconnue dans le contenu reçu', 400);

    // ── Rapprochement nodeId → site ──────────────────────────
    const sites = await prisma.site.findMany({
      where: { isActive: true },
      select: { id: true, code: true, nom: true, nodeId: true },
    });
    const parNodeId = new Map(sites.filter((s) => s.nodeId).map((s) => [s.nodeId!, s]));
    // Adoption automatique STRICTE : nom OSS (préfixe GL/L retiré) exactement
    // égal au nom OU au code du site normalisé (l'OSS mélange les deux, ex.
    // « LTG111 »). Un rapprochement douteux ne s'invente pas.
    const parNomNormalise = new Map(sites.map((s) => [normaliser(s.nom), s]));
    const parCodeNormalise = new Map(sites.map((s) => [normaliser(s.code), s]));
    let adoptes = 0;
    const nonRapproches: string[] = [];

    const resoudre = async (l: LigneOss) => {
      const direct = parNodeId.get(l.nodeId);
      if (direct) return direct;
      if (l.name && l.name !== 'undefined') {
        const brut = normaliser(l.name);
        const sansPrefixe = normaliser(l.name.replace(/^GL?/, ''));
        const candidat = parNomNormalise.get(sansPrefixe)
          ?? parNomNormalise.get(brut)
          ?? parCodeNormalise.get(brut)
          ?? parCodeNormalise.get(sansPrefixe);
        if (candidat && !candidat.nodeId) {
          await prisma.site.update({ where: { id: candidat.id }, data: { nodeId: l.nodeId } });
          candidat.nodeId = l.nodeId;
          parNodeId.set(l.nodeId, candidat);
          adoptes++;
          return candidat;
        }
      }
      return null;
    };

    // ── Réconciliation ───────────────────────────────────────
    let creees = 0;
    let cloturees = 0;
    let dejaOuvertes = 0;

    for (const l of lignes) {
      const site = await resoudre(l);
      if (!site) {
        if (l.etat === 'disconnected') nonRapproches.push(`${l.nodeId} (${l.name})`);
        continue;
      }

      if (l.etat === 'disconnected') {
        // Une coupure SITE déjà ouverte (humaine ou OSS) → rien à créer.
        const ouverte = await prisma.coupureReseau.findFirst({
          where: { siteId: site.id, technologie: 'SITE', dateFin: null },
          select: { id: true },
        });
        if (ouverte) { dejaOuvertes++; continue; }
        await prisma.coupureReseau.create({
          data: {
            siteId: site.id,
            technologie: 'SITE',
            origine: 'LOCALE',
            source: 'OSS',
            dateDebut: l.quand,
            nocEngineer: 'AUTO-OSS',
            observations: 'Détection automatique OSS (mode observation — pas de notification).',
          },
        });
        creees++;
      } else {
        // connected : clôturer la coupure OSS ouverte — la date de la ligne est
        // l'heure de reconnexion. Les coupures MANUELLES restent à la main du NOC.
        const ouverte = await prisma.coupureReseau.findFirst({
          where: { siteId: site.id, technologie: 'SITE', dateFin: null, source: 'OSS' },
          select: { id: true, dateDebut: true },
        });
        if (!ouverte) continue;
        const fin = l.quand > ouverte.dateDebut ? l.quand : new Date();
        await prisma.coupureReseau.update({
          where: { id: ouverte.id },
          data: {
            dateFin: fin,
            downtimeMinutes: Math.max(0, Math.round((fin.getTime() - ouverte.dateDebut.getTime()) / 60000)),
            actions: 'Rétablissement constaté par l\'OSS (reconnexion eNodeB).',
          },
        });
        cloturees++;
      }
    }

    const bilan = {
      lignesAnalysees: lignes.length,
      sitesRapproches: lignes.length - nonRapproches.length,
      rapprochementsAdoptes: adoptes,
      coupuresCreees: creees,
      coupuresCloturees: cloturees,
      coupuresDejaOuvertes: dejaOuvertes,
      // Seuls les DISCONNECTED non rapprochés sont listés : ce sont eux qui
      // échappent à la détection — à mapper en priorité (fiche site → NodeID).
      disconnectedNonRapproches: nonRapproches,
    };
    logger.info(`[sync-oss] ${lignes.length} lignes · ${creees} coupure(s) créée(s) · ${cloturees} clôturée(s) · ${nonRapproches.length} down non rapproché(s)`);
    res.json({ success: true, data: bilan });
  } catch (err) { next(err); }
}
