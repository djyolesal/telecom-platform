import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';
import { getNum } from '../services/settings.service';
// coupuresReseau.controller importe `io` depuis ../server : un import direct
// ici démarrerait le serveur dans les tests du parseur (Jest ne rend jamais la
// main). Import PARESSEUX au moment de la clôture, comme notifications.service.
const chargerRebouclage = () =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('./coupuresReseau.controller') as typeof import('./coupuresReseau.controller');

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
      select: { id: true, code: true, nom: true, nodeId: true, parentTransmissionId: true },
    });
    const parNodeId = new Map(sites.filter((s) => s.nodeId).map((s) => [s.nodeId!, s]));
    const siteParId = new Map(sites.map((s) => [s.id, s]));

    // ── Topologie + coupures SITE ouvertes (une lecture par passage) ─────────
    // Sert au classement automatique amont/aval : une rafale de détections sur
    // un axe de transmission = UNE panne amont, pas N pannes indépendantes.
    const enfantsDe = new Map<string, string[]>();
    for (const s of sites) {
      if (!s.parentTransmissionId) continue;
      const l = enfantsDe.get(s.parentTransmissionId);
      if (l) l.push(s.id); else enfantsDe.set(s.parentTransmissionId, [s.id]);
    }
    interface CoupureOuverte {
      id: string; siteId: string; dateDebut: Date; origine: string;
      coupureOrigineId: string | null; source: string; incidentId: string | null;
      priseEnChargePar: string | null;
    }
    const ouvertesInit = await prisma.coupureReseau.findMany({
      where: { technologie: 'SITE', dateFin: null },
      select: {
        id: true, siteId: true, dateDebut: true, origine: true,
        coupureOrigineId: true, source: true, incidentId: true, priseEnChargePar: true,
      },
    });
    const ouverteParSite = new Map<string, CoupureOuverte>(ouvertesInit.map((c) => [c.siteId, c]));
    const ouverteParId = new Map<string, CoupureOuverte>(ouvertesInit.map((c) => [c.id, c]));
    // Entraînement plausible : l'aval tombe APRÈS (ou quasi en même temps que)
    // l'amont — un site tombé bien avant son amont est une panne locale.
    // Retour terrain : en coupure d'énergie régionale, chaque site tombe quand
    // SA batterie meurt - l'amont peut tenir bien plus longtemps que ses aval.
    // 15 min laissaient 19 sites sur 20 « locaux ». Fenêtre paramétrable
    // (Administration → Paramètres), 60 min par défaut ; un aval tombé APRÈS la
    // racine reste entraîné sans limite tant qu'elle est ouverte.
    const TOLERANCE_MS = getNum('oss.fenetreEntrainementMin', 60) * 60_000;
    const resoudreRacine = (c: CoupureOuverte): CoupureOuverte =>
      (c.origine === 'HERITEE' && c.coupureOrigineId && ouverteParId.get(c.coupureOrigineId)) || c;
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
    let creeesHeritees = 0;
    let reclasseesAval = 0;
    let cloturees = 0;
    let clotureesHeritees = 0;
    let incidentsResolus = 0;
    let dejaOuvertes = 0;

    for (const l of lignes) {
      const site = await resoudre(l);
      if (!site) {
        if (l.etat === 'disconnected') nonRapproches.push(`${l.nodeId} (${l.name})`);
        continue;
      }

      if (l.etat === 'disconnected') {
        // Une coupure SITE déjà ouverte (humaine ou OSS) → rien à créer.
        if (ouverteParSite.has(site.id)) { dejaOuvertes++; continue; }

        // Classement automatique AMONT : si un site de la chaîne de transmission
        // amont est déjà coupé (le plus HAUT gagne), cette détection naît
        // HÉRITÉE — le sas ne montre qu'une racine par panne réelle. Si la
        // racine est déjà prise en charge, l'héritée hérite de l'adoption.
        let racineAmont: CoupureOuverte | null = null;
        let curseur = siteParId.get(site.id)?.parentTransmissionId ?? null;
        for (let saut = 0; curseur && saut < 30; saut++) {
          const c = ouverteParSite.get(curseur);
          if (c) racineAmont = resoudreRacine(c);
          curseur = siteParId.get(curseur)?.parentTransmissionId ?? null;
        }
        const entrainee = !!racineAmont && l.quand.getTime() >= racineAmont.dateDebut.getTime() - TOLERANCE_MS;

        // Index unique (site, technologie, fréquence, début) - migration 0029 :
        // si le NOC a CLÔTURÉ la coupure alors que l'OSS liste encore le même
        // début de panne, la re-création tomberait en conflit et ferait échouer
        // TOUT le passage. Doublon exact = déjà connue, on passe.
        let creee;
        try {
          creee = await prisma.coupureReseau.create({
          data: {
            siteId: site.id,
            technologie: 'SITE',
            origine: entrainee ? 'HERITEE' : 'LOCALE',
            coupureOrigineId: entrainee ? racineAmont!.id : undefined,
            source: 'OSS',
            dateDebut: l.quand,
            nocEngineer: 'AUTO-OSS',
            priseEnChargePar: entrainee ? racineAmont!.priseEnChargePar : undefined,
            priseEnChargeLe: entrainee && racineAmont!.priseEnChargePar ? new Date() : undefined,
            observations: entrainee
              ? `Détection automatique OSS - héritée de la panne amont (${siteParId.get(racineAmont!.siteId)?.nom ?? 'site amont'}).`
              : 'Détection automatique OSS (mode observation - pas de notification).',
          },
          select: {
            id: true, siteId: true, dateDebut: true, origine: true,
            coupureOrigineId: true, source: true, incidentId: true, priseEnChargePar: true,
          },
        });
        } catch (e) {
          if ((e as { code?: string })?.code === 'P2002') { dejaOuvertes++; continue; }
          throw e;
        }
        ouverteParSite.set(site.id, creee); ouverteParId.set(creee.id, creee);
        creees++; if (entrainee) creeesHeritees++;

        // Classement automatique AVAL (l'amont peut être parsé APRÈS ses aval) :
        // les coupures OSS LOCALES déjà ouvertes dans la descendance, tombées
        // dans la fenêtre d'entraînement, se rattachent à cette nouvelle racine.
        if (!entrainee) {
          const aReclasser: CoupureOuverte[] = [];
          const file = [site.id];
          while (file.length) {
            const idSite = file.shift()!;
            for (const enfant of enfantsDe.get(idSite) ?? []) {
              const c = ouverteParSite.get(enfant);
              if (c && c.origine === 'LOCALE' && c.source === 'OSS' && !c.incidentId
                && c.dateDebut.getTime() >= creee.dateDebut.getTime() - TOLERANCE_MS) aReclasser.push(c);
              file.push(enfant);
            }
          }
          if (aReclasser.length) {
            await prisma.coupureReseau.updateMany({
              where: { id: { in: aReclasser.map((c) => c.id) } },
              data: { origine: 'HERITEE', coupureOrigineId: creee.id },
            });
            for (const c of aReclasser) { c.origine = 'HERITEE'; c.coupureOrigineId = creee.id; }
            reclasseesAval += aReclasser.length;
          }
        }
      } else {
        // connected : clôturer la coupure OSS ouverte — la date de la ligne est
        // l'heure de reconnexion. Les coupures MANUELLES restent à la main du NOC.
        const ouverte = ouverteParSite.get(site.id);
        if (!ouverte || ouverte.source !== 'OSS') continue;
        const fin = l.quand > ouverte.dateDebut ? l.quand : new Date();
        await prisma.coupureReseau.update({
          where: { id: ouverte.id },
          data: {
            dateFin: fin,
            downtimeMinutes: Math.max(0, Math.round((fin.getTime() - ouverte.dateDebut.getTime()) / 60000)),
            actions: 'Rétablissement constaté par l\'OSS (reconnexion eNodeB).',
          },
        });
        ouverteParSite.delete(site.id); ouverteParId.delete(ouverte.id);
        cloturees++;

        // Coupure armée (incident créé à la prise en charge) : le rétablissement
        // OSS doit REBOUCLER l'incident - sinon il resterait ouvert à vie
        // (escalade horaire sans fin). Résolution automatique + notification
        // « déplacement inutile » aux techniciens si aucune intervention.
        if (ouverte.incidentId) {
          const { resoudreIncidentSiPlusDeCoupure, notifierResolutionAutomatique } = chargerRebouclage();
          const resolu = await prisma.$transaction((tx) =>
            resoudreIncidentSiPlusDeCoupure(tx, ouverte.incidentId, fin)
          );
          if (resolu) { incidentsResolus++; void notifierResolutionAutomatique(ouverte.incidentId); }
        }

        // Héritées « aveugles » de cette racine (sites aval SANS nodeId : l'OSS
        // ne les verra jamais se reconnecter) : clôture en cascade, même heure.
        const aveugles = await prisma.coupureReseau.findMany({
          where: { coupureOrigineId: ouverte.id, dateFin: null, source: 'OSS', site: { nodeId: null } },
          select: { id: true, siteId: true, dateDebut: true },
        });
        for (const h of aveugles) {
          await prisma.coupureReseau.update({
            where: { id: h.id },
            data: {
              dateFin: fin,
              downtimeMinutes: Math.max(0, Math.round((fin.getTime() - h.dateDebut.getTime()) / 60000)),
              actions: 'Rétablissement hérité de la racine amont (constat OSS).',
            },
          });
          ouverteParSite.delete(h.siteId); ouverteParId.delete(h.id);
          clotureesHeritees++;
        }
      }
    }

    const bilan = {
      lignesAnalysees: lignes.length,
      sitesRapproches: lignes.length - nonRapproches.length,
      rapprochementsAdoptes: adoptes,
      coupuresCreees: creees,
      dontHeriteesAmont: creeesHeritees,
      reclasseesHeriteesAval: reclasseesAval,
      coupuresCloturees: cloturees,
      heriteesAveuglesCloturees: clotureesHeritees,
      incidentsResolus,
      coupuresDejaOuvertes: dejaOuvertes,
      // Seuls les DISCONNECTED non rapprochés sont listés : ce sont eux qui
      // échappent à la détection — à mapper en priorité (fiche site → NodeID).
      disconnectedNonRapproches: nonRapproches,
    };
    logger.info(`[sync-oss] ${lignes.length} lignes · ${creees} coupure(s) créée(s) · ${cloturees} clôturée(s) · ${nonRapproches.length} down non rapproché(s)`);
    res.json({ success: true, data: bilan });
  } catch (err) { next(err); }
}
