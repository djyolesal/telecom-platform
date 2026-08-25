import { Request, Response, NextFunction } from 'express';
import ExcelJS from 'exceljs';
import { Readable } from 'stream';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { paginate } from '../utils/paginator';
import { triListe } from '../utils/triListe';
import { auditLog } from '../services/audit.service';
import { sitePerimetre, isRestreint, assertSiteInPerimetre } from '../utils/perimetre';
import { descendantsTransmission } from '../utils/transmission';
import { genererReference, alignerCompteur } from '../services/reference.service';

/**
 * Événement temps réel « les coupures ont changé » (namespace /supervision) :
 * le web invalide ses requêtes à la seconde au lieu d'attendre le poll 60 s.
 * Best-effort - ne bloque jamais la mutation qui l'émet.
 */
export function emettreCoupuresChangees(detail: Record<string, unknown> = {}): void {
  try {
    io.of('/supervision').emit('coupures:changees', { ...detail, a: Date.now() });
  } catch (e) {
    logger.warn('[coupures] émission temps réel échouée:', e);
  }
}

/**
 * Auto-réparation du compteur de références INC : après un import de données
 * réelles, des incidents existent avec des références jamais passées par le
 * compteur - la première création suivante part en conflit unique (P2002,
 * « valeur déjà existante »). On rattrape alors le compteur sur le max
 * existant et on rejoue UNE fois la transaction.
 */
async function avecRattrapageReferenceInc<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const annee = new Date().getFullYear();
      const derniere = await prisma.incident.findFirst({
        where: { reference: { startsWith: `INC-${annee}-` } },
        orderBy: { reference: 'desc' },
        select: { reference: true },
      });
      const num = parseInt(derniere?.reference?.split('-')[2] ?? '0', 10) || 0;
      logger.warn(`[coupures] compteur INC en retard (référence max existante n°${num}) - rattrapage puis nouvelle tentative`);
      await alignerCompteur(prisma, 'INC', annee, num);
      return fn();
    }
    throw e;
  }
}
import { notifierIncidentCoupure, rendreTemplate } from '../services/sms.service';
import { notificationService } from '../services/notifications.service';
import { sendTabular, EXPORT_MAX, TabularSheet } from '../utils/exporter';
import { setXlsxHeaders } from '../utils/excel';
import { construireClasseurCoupures, COLONNES_DETAIL } from '../services/coupuresExport.service';
import { logger } from '../utils/logger';
import { Intervalle, minutesUnion, minutesUnionParCle, pousser } from '../utils/intervals';
import { io } from '../server';

export const TECHNOLOGIES = ['2G', '3G', '4G', '5G', 'SITE'] as const;

const minutesEntre = (debut: Date, fin: Date) => Math.max(0, Math.round((fin.getTime() - debut.getTime()) / 60_000));

// Alarmes « énergie » (AE/GE/EN) → indisponibilité pré-classée PASSIF
// (environnement/énergie, responsabilité O&M) ; le technicien affine à la résolution.
const ALARMES_ENERGIE = new Set(['AE', 'GE', 'EN']);

/**
 * Aiguillage des coupures LOCALES encore en cours, site par site :
 * — SITE ENTIER tombé (ligne SITE, ou les 4 technos down) → l'énergie est la
 *   cause probable : UN incident terrain (groupé par site) dispatché par SMS
 *   aux contacts du prestataire PASSIF du lot ;
 * — coupure PARTIELLE (le site est alimenté) → pas d'incident : simple
 *   notification SMS aux équipes ACTIVES (radio/transmission), une seule fois.
 * Les coupures héritées (impact aval) ne génèrent ni incident ni notification :
 * le travail est sur le site origine.
 */
export async function rattacherIncidentsCoupures(userId: string, siteIds?: string[]): Promise<number> {
  // Scopé aux sites RÉELLEMENT touchés par l'opération courante : sans cela une
  // simple saisie balayait tout le parc (incidents et SMS sur des sites tiers,
  // hors périmètre de l'auteur, et N+1 sur des centaines de sites).
  const orphelines = await prisma.coupureReseau.findMany({
    where: {
      dateFin: null, origine: 'LOCALE', incidentId: null,
      ...(siteIds?.length ? { siteId: { in: siteIds } } : {}),
    },
    include: { site: { select: { nom: true } } },
    orderBy: { dateDebut: 'asc' },
  });
  if (!orphelines.length) return 0;

  const parSite = new Map<string, typeof orphelines>();
  for (const c of orphelines) {
    const l = parSite.get(c.siteId) ?? [];
    l.push(c);
    parSite.set(c.siteId, l);
  }

  let crees = 0;
  for (const [siteId, coupures] of parSite) {
    const technos = [...new Set(coupures.map((c) => c.technologie))];
    const siteEntier = technos.includes('SITE')
      || ['2G', '3G', '4G', '5G'].every((t) => technos.includes(t));

    if (!siteEntier) {
      // Partiel → ACTIF par nature (le site est alimenté). Notification unique.
      await prisma.coupureReseau.updateMany({
        where: { id: { in: coupures.map((c) => c.id) }, causeCategorie: null, typeAlarme: { notIn: [...ALARMES_ENERGIE] } },
        data: { causeCategorie: 'ACTIF' },
      });
      // Verrou + marquage AVANT l'envoi, dans une transaction : deux imports
      // concurrents sur le même site lisaient tous deux notifieeActif=false et
      // envoyaient chacun le SMS (double notification payante). On réserve
      // atomiquement les lignes à notifier (updateMany conditionnel) ; seul le
      // gagnant obtient une liste non vide et envoie.
      const reserves = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'inc:' + siteId})::bigint)`;
        const aNotifier = coupures.filter((c) => !c.notifieeActif).map((c) => c.id);
        if (!aNotifier.length) return 0;
        const r = await tx.coupureReseau.updateMany({
          where: { id: { in: aNotifier }, notifieeActif: false },
          data: { notifieeActif: true },
        });
        return r.count;
      });
      if (reserves > 0) {
        await notifierIncidentCoupure(
          siteId,
          rendreTemplate('sms.tpl.coupurePartielle', { technos: technos.join('/'), site: coupures[0].site.nom }),
          'COUPURE_PARTIELLE_NOC',
          'ACTIVE',
          'coupures'
        );
      }
      continue;
    }

    // Lecture + création + rattachement sous VERROU consultatif par site, dans
    // une seule transaction : sinon deux imports concurrents créaient deux
    // incidents CRITIQUE pour la même panne, et le second updateMany laissait le
    // premier incident OUVERT sans aucune coupure — jamais clôturable.
    const { incident, cree } = await avecRattrapageReferenceInc(() => prisma.$transaction(async (tx) => {
      // $executeRaw (pas $queryRaw) : pg_advisory_xact_lock renvoie `void`, que
      // Prisma refuse de désérialiser — l'import entier tombait en 500.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'inc:' + siteId})::bigint)`;
      // `some: { dateFin: null }` : un incident dont toutes les coupures sont
      // rétablies ne doit PAS être recyclé (sa dateOuverture ferait exploser le
      // MTTR et les pénalités de délai).
      const existant = await tx.incident.findFirst({
        where: { siteId, statut: { in: ['OUVERT', 'EN_COURS'] }, coupures: { some: { dateFin: null } } },
        select: { id: true, reference: true },
      });
      if (existant) {
        await tx.coupureReseau.updateMany({ where: { id: { in: coupures.map((c) => c.id) } }, data: { incidentId: existant.id } });
        return { incident: existant, cree: false };
      }
      const nouveau = await tx.incident.create({
        data: {
          reference: await genererReference(tx, 'INC', new Date()),
          siteId,
          type: 'COUPURE_TOTALE',
          severite: 'CRITIQUE',
          description: `Site entier hors service (coupure ${technos.join('/')}) signalé par le NOC${coupures[0].typeAlarme ? ` - alarme ${coupures[0].typeAlarme}` : ''}.`,
          declarePar: userId,
          // L'incident s'ouvre au DÉBUT réel de la panne, pas au moment de la
          // saisie : le NOC insère souvent APRÈS coup (début rétroactif) —
          // sinon le MTTR est faux et une clôture antérieure à la saisie
          // violait la contrainte résolution ≥ ouverture. Borné à maintenant.
          dateOuverture: new Date(Math.min(...coupures.map((c) => c.dateDebut.getTime()), Date.now())),
        },
        select: { id: true, reference: true },
      });
      await tx.coupureReseau.updateMany({ where: { id: { in: coupures.map((c) => c.id) } }, data: { incidentId: nouveau.id } });
      return { incident: nouveau, cree: true };
    }));

    if (cree) {
      crees++;
      io.of('/supervision').emit('incident:created', { id: incident.id, siteId });
      // Ampleur de la chaîne dans le SMS ({impactes}) : sites aval distincts
      // dont l'héritée ouverte pointe sur une des coupures racines notifiées.
      // Les héritées sont créées/marquées AVANT cet aiguillage (saisie comme
      // import), le compte est donc déjà juste au moment de l'envoi.
      const aval = await prisma.coupureReseau.findMany({
        where: { coupureOrigineId: { in: coupures.map((c) => c.id) }, dateFin: null },
        select: { siteId: true },
        distinct: ['siteId'],
      });
      const s = aval.length > 1 ? 's' : '';
      const impactes = aval.length ? ` (+${aval.length} site${s} aval impacté${s})` : '';
      await notifierIncidentCoupure(
        siteId,
        rendreTemplate('sms.tpl.siteHorsService', {
          site: coupures[0].site.nom,
          reference: incident.reference ?? '',
          impactes,
        }),
        'INCIDENT_COUPURE_NOC',
        'PASSIVE'
      );
      // Push in-app/FCM aux TECHNICIENS passifs du lot : gratuit, lien direct
      // vers l'incident — double le SMS sans coût passerelle.
      try {
        const lot = await prisma.site.findUnique({
          where: { id: siteId },
          select: { lot: { select: { assignments: { select: { prestataireId: true, scope: true } } } } },
        });
        const prestas = (lot?.lot?.assignments ?? [])
          .filter((a) => a.scope !== 'ACTIVE')
          .map((a) => a.prestataireId);
        if (prestas.length) {
          const techs = await prisma.user.findMany({
            where: { role: 'TECHNICIEN', isActive: true, prestataireId: { in: prestas } },
            select: { id: true },
          });
          await Promise.all(techs.map((t) => notificationService.sendToUser(t.id, {
            title: `🔴 ${coupures[0].site.nom} hors service`,
            body: `Incident ${incident!.reference ?? ''} créé par le NOC - intervention terrain requise.`,
            data: { incidentId: incident!.id, type: 'incident' },
          })));
        }
      } catch (e) {
        // Le push ne doit jamais faire échouer la création de l'incident —
        // mais un échec systématique doit rester visible dans les logs.
        logger.warn('[coupures] push technicien échoué:', e);
      }
    }
    // Pré-classement : alarme énergie → PASSIF (affinable à la résolution).
    const passives = coupures.filter((c) => c.typeAlarme && ALARMES_ENERGIE.has(c.typeAlarme));
    if (passives.length) {
      await prisma.coupureReseau.updateMany({
        where: { id: { in: passives.map((c) => c.id) }, causeCategorie: null },
        data: { causeCategorie: 'PASSIF' },
      });
    }
  }
  return crees;
}

/**
 * Détection des coupures HÉRITÉES à l'import : le rapport NOC liste chaque site
 * impacté sur sa propre ligne — les lignes qui partagent EXACTEMENT les mêmes
 * début/fin sont groupées, et si un site du groupe est l'ancêtre de transmission
 * des autres (topologie), les descendants sont reclassés HERITEE, liés à la
 * ligne racine. Elles sortent alors du circuit incident/SMS et de l'imputation
 * SLA. Une ligne déjà rattachée à un incident n'est jamais reclassée (pas
 * d'incident orphelin) ; une topologie incomplète laisse simplement les lignes
 * locales — jamais pire que l'existant.
 */
async function detecterHeriteesImport(depuis?: Date): Promise<number> {
  const [candidates, sites] = await Promise.all([
    prisma.coupureReseau.findMany({
      // Bornée à la fenêtre RÉELLEMENT importée : sans borne, chaque import
      // rejouait le classement sur toute la table — un mois déjà facturé
      // changeait de pénalités (reclassement HERITEE rétroactif), et le scan
      // intégral devenait le point chaud de l'import.
      where: { origine: 'LOCALE', ...(depuis ? { dateDebut: { gte: depuis } } : {}) },
      select: { id: true, siteId: true, technologie: true, dateDebut: true, dateFin: true, incidentId: true },
    }),
    prisma.site.findMany({ where: { isActive: true }, select: { id: true, parentTransmissionId: true } }),
  ]);
  const parentDe = new Map(sites.map((s) => [s.id, s.parentTransmissionId]));

  // Groupes par fenêtre exacte (le rapport duplique début/fin à la minute près).
  const groupes = new Map<string, typeof candidates>();
  for (const c of candidates) {
    const cle = `${c.dateDebut.getTime()}|${c.dateFin ? c.dateFin.getTime() : 'ouverte'}`;
    const g = groupes.get(cle); if (g) g.push(c); else groupes.set(cle, [c]);
  }

  const maj: { id: string; coupureOrigineId: string }[] = [];
  for (const groupe of groupes.values()) {
    const parSite = new Map<string, typeof candidates>();
    for (const c of groupe) { const l = parSite.get(c.siteId); if (l) l.push(c); else parSite.set(c.siteId, [c]); }
    if (parSite.size < 2) continue;

    for (const [siteId, lignes] of parSite) {
      // Ancêtre de transmission le plus proche présent dans le même groupe.
      let racineSiteId: string | null = null;
      let cur = parentDe.get(siteId) ?? null;
      for (let i = 0; i < 100 && cur; i++) {
        if (parSite.has(cur)) { racineSiteId = cur; break; }
        cur = parentDe.get(cur) ?? null;
      }
      if (!racineSiteId) continue;
      const lignesRacine = parSite.get(racineSiteId)!;
      // La propagation à l'aval n'a de sens que si l'ancêtre est ENTIÈREMENT
      // tombé (perte d'énergie → perte du lien). Une coupure PARTIELLE de
      // l'amont (une techno down, site alimenté) laisse la transmission en
      // service : les lignes aval sont des pannes LOCALES, pas des héritées.
      // Sans ce contrôle, une simple coïncidence de fenêtre (l'opérateur
      // horodate un lot à la même minute) masquait une panne locale réelle
      // (ni incident, ni imputation SLA). Règle alignée sur createCoupure et
      // rattacherIncidentsCoupures.
      const technosRacine = new Set(lignesRacine.map((l) => l.technologie));
      const racineSiteEntier = technosRacine.has('SITE')
        || ['2G', '3G', '4G', '5G'].every((t) => technosRacine.has(t));
      if (!racineSiteEntier) continue;
      const racine = lignesRacine.find((l) => l.technologie === 'SITE') ?? lignesRacine[0];
      for (const l of lignes) {
        if (l.incidentId) continue; // incident déjà dispatché → on ne réécrit pas l'histoire
        maj.push({ id: l.id, coupureOrigineId: racine.id });
      }
    }
  }

  for (let i = 0; i < maj.length; i += 100) {
    await prisma.$transaction(
      maj.slice(i, i + 100).map((m) =>
        prisma.coupureReseau.update({
          where: { id: m.id },
          data: { origine: 'HERITEE', coupureOrigineId: m.coupureOrigineId },
        })
      )
    );
  }
  return maj.length;
}

/**
 * Clôture RÉCURSIVE de l'arbre des coupures héritées (A→B→C…) : la détection
 * crée des chaînes, or la cascade ne descendait qu'un niveau — les héritées de
 * second rang restaient ouvertes à vie et faisaient dériver la disponibilité.
 */
export async function cloturerHeriteesRecursif(
  tx: Prisma.TransactionClient,
  racineIds: string[],
  fin: Date,
  actions?: string | null
): Promise<number> {
  let niveau = racineIds;
  let total = 0;
  for (let profondeur = 0; profondeur < 50 && niveau.length; profondeur++) {
    const enfants = await tx.coupureReseau.findMany({
      where: { coupureOrigineId: { in: niveau }, dateFin: null },
      select: { id: true, dateDebut: true },
    });
    if (!enfants.length) break;
    for (const e of enfants) {
      // Une héritée peut avoir été saisie avec un début postérieur à la fin de
      // la racine : on borne à son propre début (downtime 0) — la contrainte
      // date_fin >= date_debut refuserait l'écriture sinon.
      const finEffective = fin < e.dateDebut ? e.dateDebut : fin;
      await tx.coupureReseau.update({
        where: { id: e.id },
        data: {
          dateFin: finEffective,
          downtimeMinutes: minutesEntre(e.dateDebut, finEffective),
          ...(actions ? { actions } : {}),
        },
      });
    }
    total += enfants.length;
    niveau = enfants.map((e) => e.id);
  }
  return total;
}

/**
 * Rebouclage coupure → incident : quand la DERNIÈRE coupure ouverte d'un
 * incident est rétablie, l'incident ne doit plus rester OUVERT (sinon escalade
 * horaire et SMS de situation à perpétuité, et recyclage par une panne ultérieure).
 */
/**
 * Push in-app/FCM aux techniciens PASSIFS du lot quand un incident se résout
 * SANS intervention (rétablissement constaté par le NOC) : un technicien en
 * route sait que le déplacement est inutile. Contenu éditable (modèle
 * notif.tpl.incidentResoluAuto). Best-effort - jamais bloquant.
 */
export async function notifierResolutionAutomatique(incidentId: string | null): Promise<void> {
  if (!incidentId) return;
  try {
    const inc = await prisma.incident.findUnique({
      where: { id: incidentId },
      select: {
        id: true, reference: true, dateIntervention: true,
        site: { select: { nom: true, lot: { select: { assignments: { select: { prestataireId: true, scope: true } } } } } },
      },
    });
    // Une vraie intervention a eu lieu : la clôture terrain suit son cours.
    if (!inc || inc.dateIntervention) return;
    const prestas = (inc.site.lot?.assignments ?? [])
      .filter((a) => a.scope !== 'ACTIVE')
      .map((a) => a.prestataireId);
    if (!prestas.length) return;
    const techs = await prisma.user.findMany({
      where: { role: 'TECHNICIEN', isActive: true, prestataireId: { in: prestas } },
      select: { id: true },
    });
    const corps = rendreTemplate('notif.tpl.incidentResoluAuto', { site: inc.site.nom, reference: inc.reference ?? '' });
    await Promise.all(techs.map((t) => notificationService.sendToUser(t.id, {
      title: `✅ ${inc.site.nom} rétabli`,
      body: corps,
      data: { incidentId: inc.id, type: 'incident_resolu_auto' },
    })));
  } catch (e) {
    logger.warn('[coupures] push résolution automatique échoué:', e);
  }
}

export async function resoudreIncidentSiPlusDeCoupure(
  tx: Prisma.TransactionClient,
  incidentId: string | null,
  quand: Date
): Promise<boolean> {
  if (!incidentId) return false;
  const reste = await tx.coupureReseau.count({ where: { incidentId, dateFin: null } });
  if (reste > 0) return false;
  const inc = await tx.incident.findUnique({
    where: { id: incidentId },
    select: { statut: true, dateOuverture: true, dateIntervention: true, actionCorrective: true },
  });
  if (!inc || !['OUVERT', 'EN_COURS'].includes(inc.statut)) return false;
  // La résolution ne peut pas PRÉCÉDER l'ouverture (contrainte SQL
  // incidents_resolution_apres_ouverture). Le cas réel : l'incident naît à la
  // PRISE EN CHARGE, donc APRÈS le début de la coupure — si le NOC clôture
  // ensuite avec un rétablissement antérieur à l'adoption, la résolution
  // tomberait avant l'ouverture et TOUTE la clôture partait en 500. On borne
  // à l'ouverture (durée 0) : l'incident a couvert un rétablissement déjà
  // acquis, la durée d'indisponibilité réelle vit sur la coupure.
  const quandEffectif = quand < inc.dateOuverture ? inc.dateOuverture : quand;
  // Rétabli SANS passage sur site (aucune intervention enregistrée) : le dire
  // explicitement — sinon l'incident résolu ressemble, dans les stats et à la
  // relecture, à une intervention terrain qui n'a jamais eu lieu.
  const sansIntervention = inc.dateIntervention == null;
  await tx.incident.update({
    where: { id: incidentId },
    data: {
      statut: 'RESOLU',
      dateResolution: quandEffectif,
      dureeCoupureMinutes: minutesEntre(inc.dateOuverture, quandEffectif),
      ...(sansIntervention && !inc.actionCorrective
        ? { actionCorrective: 'Rétablissement constaté par le NOC - aucune intervention terrain.' }
        : {}),
    },
  });
  return true;
}

/** Filtres communs liste/export (période, statut, techno, alarme, recherche) + périmètre. */
async function whereCoupures(req: Request): Promise<Record<string, unknown>> {
  const { site_id, technologie, type_alarme, statut, date_debut, date_fin, search, source, origine, a_qualifier } =
    req.query as Record<string, string>;
  const where: Record<string, unknown> = {};
  if (site_id) where.siteId = site_id;
  if (technologie) where.technologie = technologie;
  if (type_alarme) where.typeAlarme = type_alarme;
  // Source LOGIQUE (pas la colonne brute) : le rapport NOC (MANUEL) inclut
  // les AUTO ADOPTÉES — c'est lui qui est envoyé et qui fonde la dispo ;
  // l'onglet AUTO ne montre que le sas des détections non prises en charge.
  // (La colonne source en base reste OSS : la clôture auto continue d'agir.)
  if (source === 'OSS') { where.source = 'OSS'; where.priseEnChargePar = null; }
  // LOCALE = racines seulement (les héritées de l'aval noient la liste) ;
  // HERITEE = l'inverse. Absent = tout.
  if (origine) where.origine = origine;
  // Conditions à OR internes cumulables : chacune pousse dans AND pour ne pas
  // s'écraser mutuellement (a_qualifier + période utilisent tous deux un OR).
  const et: Record<string, unknown>[] = [];
  // « À qualifier » : type d'alarme ou classement actif/passif manquant —
  // typiquement les détections AUTO OSS, dont les rapports ont besoin.
  if (a_qualifier === '1') et.push({ OR: [{ typeAlarme: null }, { causeCategorie: null }] });
  if (source === 'MANUEL') et.push({ OR: [{ source: 'MANUEL' }, { priseEnChargePar: { not: null } }] });
  if (statut === 'EN_COURS') where.dateFin = null;
  if (statut === 'TERMINEE') where.dateFin = { not: null };
  if (date_debut || date_fin) {
    // Période = CHEVAUCHEMENT, pas « commencée dans la période » : une coupure
    // ancienne encore EN COURS (ou rétablie pendant la période) doit sortir
    // dans la vue et les exports. Filtrer sur le seul début les faisait
    // disparaître dès que la période ne contenait plus leur premier jour.
    // Une date « au » sans heure (YYYY-MM-DD) couvre la journée ENTIÈRE.
    const du = date_debut ? new Date(date_debut) : null;
    const au = date_fin ? new Date(date_fin.length === 10 ? `${date_fin}T23:59:59` : date_fin) : null;
    if (au) where.dateDebut = { lte: au };
    if (du) et.push({ OR: [{ dateFin: null }, { dateFin: { gte: du } }] });
  }
  if (et.length) where.AND = et;
  const perimetre = await sitePerimetre(req.user!.id);
  if (search || isRestreint(perimetre)) {
    where.site = {
      ...(isRestreint(perimetre) ? perimetre : {}),
      ...(search ? { nom: { contains: search, mode: 'insensitive' } } : {}),
    };
  }
  return where;
}

// Tri délégué par les en-têtes du tableau : liste BLANCHE clé → orderBy Prisma
// (le tri local du navigateur ne réordonnait que la page affichée). `site` et
// `region` trient sur la relation ; le reste sur les colonnes brutes.
const TRIS_COUPURES: Record<string, (sens: 'asc' | 'desc') => Record<string, unknown>> = {
  site: (s) => ({ site: { nom: s } }),
  region: (s) => ({ site: { region: s } }),
  technologie: (s) => ({ technologie: s }),
  dateDebut: (s) => ({ dateDebut: s }),
  dateFin: (s) => ({ dateFin: s }),
  downtimeMinutes: (s) => ({ downtimeMinutes: s }),
  typeAlarme: (s) => ({ typeAlarme: s }),
  cause: (s) => ({ cause: s }),
  frequence: (s) => ({ frequence: s }),
  secteur: (s) => ({ secteur: s }),
  causeCategorie: (s) => ({ causeCategorie: s }),
  actions: (s) => ({ actions: s }),
  technicienContacte: (s) => ({ technicienContacte: s }),
  intervenants: (s) => ({ intervenants: s }),
  observations: (s) => ({ observations: s }),
  source: (s) => ({ source: s }),
};

export async function getCoupures(req: Request, res: Response, next: NextFunction) {
  try {
    const { page = '1', limit = '20' } = req.query as Record<string, string>;
    const where = await whereCoupures(req);
    const triExplicite = triListe(req.query, TRIS_COUPURES, { dateDebut: 'desc' });
    const { data, meta } = await paginate(
      prisma.coupureReseau,
      {
        where,
        // Tri d'en-tête s'il est demandé (départage stable par début). Sinon,
        // en cours : tri COMPOSITE — les sites entiers d'abord (l'ordre
        // alphabétique inverse donne SITE > 5G > … > 2G, du plus large au
        // plus étroit), puis les plus ANCIENNES en tête dans chaque groupe.
        // Sinon : chronologie inverse classique.
        orderBy: triExplicite ?? (req.query.statut === 'EN_COURS'
          ? [{ technologie: 'desc' as const }, { dateDebut: 'asc' as const }]
          : { dateDebut: 'desc' as const }),
        include: {
          site: { select: { nom: true, region: true } },
          coupureOrigine: { select: { id: true, site: { select: { nom: true } } } },
          incident: { select: { id: true, reference: true, statut: true } },
          _count: { select: { heritees: true } },
          // Aval hérité embarqué : la page l'affiche en sous-lignes sous la
          // racine (et en infobulle du badge « N impacté(s) »).
          heritees: {
            select: {
              id: true, technologie: true, frequence: true, secteur: true,
              dateDebut: true, dateFin: true, downtimeMinutes: true,
              cause: true, actions: true, typeAlarme: true, technicienContacte: true,
              intervenants: true, observations: true, origine: true, source: true,
              causeCategorie: true, priseEnChargePar: true,
              incident: { select: { id: true, reference: true, statut: true } },
              site: { select: { nom: true, region: true } },
            },
            orderBy: { dateDebut: 'asc' },
          },
        },
      },
      { page: parseInt(page), limit: parseInt(limit) }
    );
    res.json({ success: true, data, meta });
  } catch (err) { next(err); }
}

/** Création manuelle — plusieurs technologies d'un coup (une ligne par techno). */
export async function createCoupure(req: Request, res: Response, next: NextFunction) {
  try {
    const b = req.body as Record<string, unknown>;
    const siteId = String(b.siteId ?? '');
    if (!siteId) throw new AppError('Site obligatoire', 400);
    await assertSiteInPerimetre(req.user!.id, siteId);

    const technologies: string[] = Array.isArray(b.technologies) && b.technologies.length
      ? (b.technologies as string[])
      : [String(b.technologie ?? 'SITE')];
    if (technologies.some((t) => !TECHNOLOGIES.includes(t as never))) {
      throw new AppError('Technologie invalide (2G, 3G, 4G, 5G ou SITE)', 400);
    }
    const dateDebut = b.dateDebut ? new Date(String(b.dateDebut)) : null;
    if (!dateDebut || Number.isNaN(dateDebut.getTime())) throw new AppError('Date de début invalide', 400);

    // UN site = UNE coupure SITE ouverte, quelle que soit la source. Deux
    // lignes ouvertes pour la même panne (OSS + saisie NOC à des heures
    // différentes) faisaient compter le site deux fois dans les héritées.
    if (technologies.includes('SITE')) {
      const deja = await prisma.coupureReseau.findFirst({
        where: { siteId, technologie: 'SITE', dateFin: null },
        select: { id: true, source: true, dateDebut: true },
      });
      if (deja) {
        // L'id est renvoyé en details : le formulaire propose d'OUVRIR la
        // coupure existante au lieu de laisser le NOC sur un cul-de-sac.
        throw new AppError(
          `Une coupure site entier est déjà EN COURS sur ce site (${deja.source === 'OSS' ? 'détection AUTO' : 'saisie manuelle'} du ${deja.dateDebut.toLocaleString('fr-FR', { timeZone: 'Africa/Lome' })}) - complétez ou clôturez-la plutôt que d'en créer une seconde.`,
          422,
          { coupureExistanteId: deja.id }
        );
      }
    }

    const champs = {
      siteId,
      frequence: b.frequence ? String(b.frequence).slice(0, 30) : null,
      secteur: b.secteur ? String(b.secteur).slice(0, 20) : null,
      dateDebut,
      heureContact: b.heureContact ? new Date(String(b.heureContact)) : null,
      technicienContacte: b.technicienContacte ? String(b.technicienContacte).slice(0, 100) : null,
      cause: b.cause ? String(b.cause).slice(0, 300) : null,
      typeAlarme: b.typeAlarme ? String(b.typeAlarme).slice(0, 10).toUpperCase() : null,
      observations: b.observations ? String(b.observations) : null,
    };
    const rows = await prisma.$transaction(
      technologies.map((technologie) => prisma.coupureReseau.create({ data: { ...champs, technologie } }))
    );

    // Propagation à l'AVAL de transmission : les descendants perdent leur lien
    // → une coupure SITE entier « héritée » par site aval, liée à la racine.
    // UNIQUEMENT si le site entier est tombé : une coupure partielle (une techno
    // down, site alimenté) laisse la transmission en service — propager créerait
    // des héritées fictives sur tout l'aval (règle vérifiée ici, pas seulement
    // dans le formulaire web).
    const siteEntier = technologies.includes('SITE')
      || ['2G', '3G', '4G', '5G'].every((t) => technologies.includes(t));
    let sitesImpactes = 0;
    if (b.propagerAval === true && siteEntier) {
      const aval = await descendantsTransmission(siteId);
      if (aval.length) {
        const racineId = rows[0].id;
        // UN site = UNE coupure SITE ouverte : l'aval déjà couvert (souvent la
        // détection AUTO, horodatée différemment) est RATTACHÉ à la racine au
        // lieu de recevoir une seconde ligne - le double comptage venait d'ici
        // aussi. Ne sont créées que les héritées des sites non couverts.
        const dejaOuvertes = await prisma.coupureReseau.findMany({
          where: { siteId: { in: aval.map((s) => s.id) }, technologie: 'SITE', dateFin: null },
          select: { id: true, siteId: true, origine: true, incidentId: true },
        });
        const couverts = new Set(dejaOuvertes.map((c) => c.siteId));
        const aRattacher = dejaOuvertes
          .filter((c) => c.origine === 'LOCALE' && !c.incidentId)
          .map((c) => c.id);
        if (aRattacher.length) {
          await prisma.coupureReseau.updateMany({
            where: { id: { in: aRattacher } },
            data: { origine: 'HERITEE', coupureOrigineId: racineId },
          });
        }
        const aCreer = aval.filter((s) => !couverts.has(s.id));
        if (aCreer.length) {
          await prisma.coupureReseau.createMany({
            data: aCreer.map((s) => ({
              siteId: s.id,
              technologie: 'SITE',
              dateDebut,
              cause: champs.cause ?? `Coupure amont - propagation transmission`,
              typeAlarme: champs.typeAlarme,
              origine: 'HERITEE',
              coupureOrigineId: racineId,
            })),
            skipDuplicates: true,
          });
        }
        sitesImpactes = aval.length;
      }
    }

    // Incident terrain automatique (groupé par site) + dispatch SMS prestataire,
    // uniquement pour une coupure encore EN COURS (pas la saisie d'historique).
    const incidentsCrees = await rattacherIncidentsCoupures(req.user!.id, [siteId]);

    await auditLog(req.user!.id, 'CREATE', 'coupure_reseau', rows[0].id, { siteId, technologies, sitesImpactes, incidentsCrees }, req);
    emettreCoupuresChangees({ action: 'creation', siteId });
    res.status(201).json({ success: true, data: { coupures: rows, sitesImpactes, incidentsCrees } });
  } catch (err) { next(err); }
}

/** Mise à jour / clôture : dateFin renseignée → downtime calculé automatiquement. */
export async function updateCoupure(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.coupureReseau.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Coupure introuvable', 404);
    await assertSiteInPerimetre(req.user!.id, existing.siteId);

    const b = req.body as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    for (const k of ['frequence', 'secteur', 'technicienContacte', 'intervenants', 'cause', 'actions', 'typeAlarme', 'nocEngineer', 'observations'] as const) {
      if (k in b) data[k] = b[k] == null || b[k] === '' ? null : String(b[k]);
    }
    if (typeof data.typeAlarme === 'string') data.typeAlarme = data.typeAlarme.slice(0, 10).toUpperCase();
    // Classement de l'indisponibilité (corrigeable par le NOC) : ACTIF ou PASSIF.
    if ('causeCategorie' in b) {
      const cc = b.causeCategorie == null || b.causeCategorie === '' ? null : String(b.causeCategorie).toUpperCase();
      if (cc != null && !['ACTIF', 'PASSIF'].includes(cc)) throw new AppError('causeCategorie invalide (ACTIF ou PASSIF)', 400);
      data.causeCategorie = cc;
    }
    for (const k of ['heureContact', 'dateArriveeSite', 'dateFin'] as const) {
      if (k in b) {
        const d = b[k] ? new Date(String(b[k])) : null;
        if (d && Number.isNaN(d.getTime())) throw new AppError(`${k} invalide`, 400);
        data[k] = d;
      }
    }
    // Correction du DÉBUT (saisie erronée) : autorisée aux mêmes rôles que
    // l'édition — l'ancienne valeur part dans le journal d'audit. Obligatoire,
    // pas de mise à null : une coupure a toujours un début.
    if ('dateDebut' in b && b.dateDebut) {
      const debut = new Date(String(b.dateDebut));
      if (Number.isNaN(debut.getTime())) throw new AppError('dateDebut invalide', 400);
      if (debut > new Date()) throw new AppError('Le début ne peut pas être dans le futur', 400);
      data.dateDebut = debut;
    }
    // Site : corrigeable par l'ADMIN uniquement (une erreur de cible change
    // l'imputation — la correction reste possible sans supprimer).
    if (req.user!.role === 'ADMIN' && 'siteId' in b && b.siteId) {
      const cible = await prisma.site.findUnique({ where: { id: String(b.siteId) }, select: { id: true } });
      if (!cible) throw new AppError('Site cible introuvable', 404);
      data.siteId = cible.id;
    }
    // Technologie : QUALIFIABLE par le NOC (mêmes rôles que l'édition). Cas
    // réel : l'OSS ne voit que l'eNodeB et classe « SITE » — quand seule la 4G
    // est réellement tombée (baseband LTE), le NOC requalifie en 4G : la
    // coupure sort du régime site entier (classée partielle) sans perdre son
    // historique. L'audit consigne ancienne → nouvelle valeur.
    if ('technologie' in b && b.technologie) {
      const t = String(b.technologie).toUpperCase();
      if (!['SITE', '2G', '3G', '4G', '5G'].includes(t)) throw new AppError('technologie invalide', 400);
      data.technologie = t;
    }
    // Clôture (ou ré-ouverture) → downtime recalculé, jamais saisi à la main.
    // Les saisies web sont à la MINUTE alors que le début stocké garde les
    // secondes : « début 09:09:32, fin saisie 09:09 » était refusé à tort.
    // Comparaison à la minute ; une fin dans la même minute que le début est
    // calée dessus (downtime 0).
    const laMinute = (d: Date) => Math.floor(d.getTime() / 60_000);
    const debutEffectif = (data.dateDebut as Date | undefined) ?? existing.dateDebut;
    if ('dateFin' in data) {
      let fin = data.dateFin as Date | null;
      if (fin && fin < debutEffectif) {
        if (laMinute(fin) < laMinute(debutEffectif)) throw new AppError('La fin ne peut pas précéder le début', 400);
        fin = debutEffectif;
        data.dateFin = fin;
      }
      data.downtimeMinutes = fin ? minutesEntre(debutEffectif, fin) : null;
    } else if (data.dateDebut instanceof Date && existing.dateFin) {
      // Début corrigé sur une coupure déjà rétablie : le downtime suit.
      if (existing.dateFin < data.dateDebut) {
        if (laMinute(existing.dateFin) < laMinute(data.dateDebut)) throw new AppError('Le début ne peut pas dépasser la fin existante', 400);
        data.dateDebut = existing.dateFin;
      }
      data.downtimeMinutes = minutesEntre(data.dateDebut as Date, existing.dateFin);
    }
    const updated = await prisma.coupureReseau.update({ where: { id: existing.id }, data });

    // Clôture en cascade : rétablir la racine rétablit les coupures héritées
    // encore ouvertes (même heure de fin, downtime calculé pour chacune).
    let hériteesCloturees = 0;
    if (data.dateFin instanceof Date && b.cloturerHeritees !== false) {
      const fin = data.dateFin;
      hériteesCloturees = await prisma.$transaction((tx) =>
        cloturerHeriteesRecursif(tx, [existing.id], fin, (data.actions as string | null) ?? null)
      );
    }

    // Rebouclage : si plus aucune coupure ouverte ne porte l'incident lié,
    // celui-ci passe RESOLU (sinon escalade horaire et SMS de situation à vie).
    let incidentResolu = false;
    if (data.dateFin instanceof Date && existing.incidentId) {
      incidentResolu = await prisma.$transaction((tx) =>
        resoudreIncidentSiPlusDeCoupure(tx, existing.incidentId, data.dateFin as Date)
      );
      if (incidentResolu) void notifierResolutionAutomatique(existing.incidentId);
    }

    // Réouverture par le NOC (dateFin retirée) : si l'incident lié a été résolu
    // par le technicien, il est ROUVERT — le terrain doit repasser. Tracé + SMS.
    let incidentRouvert = false;
    if ('dateFin' in data && data.dateFin === null && existing.dateFin !== null && existing.incidentId) {
      const incident = await prisma.incident.findUnique({
        where: { id: existing.incidentId },
        select: { id: true, reference: true, statut: true, site: { select: { nom: true } } },
      });
      if (incident && (incident.statut === 'RESOLU' || incident.statut === 'CLOS')) {
        await prisma.incident.update({
          where: { id: incident.id },
          data: { statut: 'EN_COURS', dateResolution: null, dureeCoupureMinutes: null },
        });
        incidentRouvert = true;
        // Symétrie : les héritées fermées par la cascade sont rouvertes, sinon
        // l'indisponibilité aval du second épisode n'était jamais comptée.
        await prisma.coupureReseau.updateMany({
          where: { coupureOrigineId: existing.id, dateFin: existing.dateFin },
          data: { dateFin: null, downtimeMinutes: null },
        });
        await auditLog(req.user!.id, 'UPDATE', 'incidents', incident.id, { action: 'reouverture_noc', coupureId: existing.id }, req);
        await notifierIncidentCoupure(
          existing.siteId,
          rendreTemplate('sms.tpl.incidentRouvert', { site: incident.site.nom, reference: incident.reference ?? '' }),
          'INCIDENT_ROUVERT_NOC'
        );
      }
    }

    await auditLog(req.user!.id, 'UPDATE', 'coupure_reseau', existing.id, {
      cloture: 'dateFin' in data, hériteesCloturees, incidentRouvert, incidentResolu,
      // Corrections sensibles : l'ancienne valeur est consignée.
      ...(data.dateDebut instanceof Date ? { ancienDebut: existing.dateDebut, nouveauDebut: data.dateDebut } : {}),
      ...(data.siteId ? { ancienSiteId: existing.siteId, nouveauSiteId: data.siteId } : {}),
      ...(data.technologie ? { ancienneTechnologie: existing.technologie, nouvelleTechnologie: data.technologie } : {}),
    }, req);
    emettreCoupuresChangees({ action: 'maj', coupureId: existing.id });
    res.json({ success: true, data: { ...updated, hériteesCloturees, incidentRouvert, incidentResolu } });
  } catch (err) { next(err); }
}

export async function deleteCoupure(req: Request, res: Response, next: NextFunction) {
  try {
    const existante = await prisma.coupureReseau.findUnique({
      where: { id: req.params.id },
      select: { id: true, incidentId: true, source: true, siteId: true, dateDebut: true, origine: true },
    });
    if (!existante) throw new AppError('Coupure introuvable', 404);
    // Le NOC/manager ne supprime que les saisies MANUELLES erronées : une
    // détection AUTO (source OSS) reflète l'état du réseau — elle se clôture
    // ou se dé-adopte (annuler la prise en charge), jamais ne se supprime.
    if (req.user!.role !== 'ADMIN' && existante.source !== 'MANUEL') {
      throw new AppError('Seules les coupures saisies manuellement peuvent être supprimées — une détection AUTO se clôture ou se dé-adopte', 422);
    }
    // Cascade explicite sur toute la descendance héritée : la FK est en
    // SET NULL — sans ça les héritées resteraient ouvertes à vie, absentes des
    // listes (sous-lignes d'une racine disparue) mais comptées dans la dispo.
    // Et supprimer la DERNIÈRE coupure ouverte d'un incident doit le reboucler,
    // comme une clôture : sinon il reste OUVERT — escaladé et SMS à vie.
    let heriteesSupprimees = 0;
    const incidents = new Set<string>();
    if (existante.incidentId) incidents.add(existante.incidentId);
    await prisma.$transaction(async (tx) => {
      let niveau = [existante.id];
      const descendance: string[] = [];
      for (let profondeur = 0; profondeur < 50 && niveau.length; profondeur++) {
        const enfants = await tx.coupureReseau.findMany({
          where: { coupureOrigineId: { in: niveau } },
          select: { id: true, incidentId: true },
        });
        for (const e of enfants) { descendance.push(e.id); if (e.incidentId) incidents.add(e.incidentId); }
        niveau = enfants.map((e) => e.id);
      }
      if (descendance.length) {
        heriteesSupprimees = (await tx.coupureReseau.deleteMany({ where: { id: { in: descendance } } })).count;
      }
      await tx.coupureReseau.delete({ where: { id: existante.id } });
      for (const incId of incidents) await resoudreIncidentSiPlusDeCoupure(tx, incId, new Date());
    });
    await auditLog(req.user!.id, 'DELETE', 'coupure_reseau', existante.id, {
      motif: 'saisie_erronee', siteId: existante.siteId, dateDebut: existante.dateDebut,
      source: existante.source, heriteesSupprimees,
    }, req);
    emettreCoupuresChangees({ action: 'suppression' });
    res.json({ success: true, data: { heriteesSupprimees } });
  } catch (err) { next(err); }
}

// ── Import du rapport Excel de supervision NOC ──────────────────────────────

const norm = (s: unknown) =>
  String(s ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]/g, '');

/** Sérial Excel (jours depuis 1899-12-30) → Date JS. */
function depuisSerialExcel(serial: number): Date {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86_400_000));
}

/**
 * Combine colonnes date + heure du rapport (heure parfois texte « 08:00:00 »).
 * En lecture en flux, les cellules datées arrivent en NUMÉROS DE SÉRIE Excel
 * (le style de format n'est pas chargé) : new Date('45809') fabriquait
 * l'an 45809, refusé par Prisma. On convertit le sérial, et toute date hors
 * d'une plage plausible est rejetée (ligne signalée plutôt qu'insérée fausse).
 */
function combiner(dateVal: unknown, heureVal: unknown): Date | null {
  if (dateVal == null || dateVal === 'N/A' || dateVal === '-') return null;
  let d: Date;
  if (dateVal instanceof Date) d = new Date(dateVal);
  else if (typeof dateVal === 'number') d = depuisSerialExcel(dateVal);
  else if (/^\d{4,6}(\.\d+)?$/.test(String(dateVal).trim())) d = depuisSerialExcel(Number(dateVal));
  else d = new Date(String(dateVal));
  if (Number.isNaN(d.getTime())) return null;
  // Garde-fou : le rapport NOC ne peut contenir que des dates « récentes ».
  const annee = d.getFullYear();
  if (annee < 2015 || annee > 2035) return null;
  if (heureVal instanceof Date) {
    d.setHours(heureVal.getUTCHours(), heureVal.getUTCMinutes(), 0, 0);
  } else if (typeof heureVal === 'string' && /^\d{1,2}:\d{2}/.test(heureVal.trim())) {
    const [h, m] = heureVal.trim().split(':').map((x) => parseInt(x, 10));
    d.setHours(h, m, 0, 0);
  } else if (typeof heureVal === 'number' && heureVal >= 0 && heureVal < 1) {
    const mins = Math.round(heureVal * 24 * 60);
    d.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
  }
  return d;
}

const cell = (row: { getCell(i: number): { value: unknown } }, i: number): unknown => {
  const v = row.getCell(i).value;
  if (v && typeof v === 'object' && 'result' in (v as object)) return (v as { result: unknown }).result;
  if (v && typeof v === 'object' && 'text' in (v as object)) return (v as { text: unknown }).text;
  return v;
};

/**
 * Import de la feuille « Events » uniquement. Idempotent : l'index d'unicité (site, technologie, fréquence,
 * début) fait qu'un ré-import du rapport cumulatif ne crée pas de doublons.
 */
export async function importCoupures(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) throw new AppError('Fichier .xlsx requis', 400);

    // Rapprochement par nom normalisé (comme l'import de sites).
    const sites = await prisma.site.findMany({ select: { id: true, nom: true, code: true } });
    const parNom = new Map<string, string>();
    for (const s of sites) { parNom.set(norm(s.nom), s.id); parNom.set(norm(s.code), s.id); }

    let crees = 0, doublons = 0;
    const nonApparies = new Map<string, number>();
    const erreurs: Array<{ feuille: string; ligne: number; message: string }> = [];
    const lots: Array<Record<string, unknown>> = [];

    // Traitement d'une ligne d'une feuille utile (Events / SITES HUAWEI).
    type LigneXlsx = { getCell(i: number): { value: unknown }; number: number };
    const traiterLigne = (nomFeuille: string, technoParDefaut: string | null, row: LigneXlsx) => {
      {
        const n = row.number;
        if (n === 1) return; // en-têtes
        const siteBrut = cell(row, 1);
        if (!siteBrut || String(siteBrut).trim() === '') return;
        const siteId = parNom.get(norm(siteBrut));
        if (!siteId) {
          nonApparies.set(String(siteBrut).trim(), (nonApparies.get(String(siteBrut).trim()) ?? 0) + 1);
          return;
        }
        const debut = combiner(cell(row, 5), cell(row, 6));
        if (!debut) { erreurs.push({ feuille: nomFeuille, ligne: n, message: 'date de début illisible' }); return; }
        let fin = combiner(cell(row, 7), cell(row, 8));
        if (fin && fin < debut) {
          // Rapport NOC : fin à cheval sur minuit dont la COLONNE DATE n'a pas
          // été incrémentée (23h50 → 00h20 « le même jour »). Si l'écart est
          // inférieur à 24 h, c'est ce cas — on répare. Au-delà, la ligne est
          // incohérente : on la signale et on l'écarte, car la contrainte
          // d'intégrité en base (date_fin >= date_debut) refuserait tout le
          // lot d'insertion — c'est un 500 sur l'import entier sinon.
          if (debut.getTime() - fin.getTime() < 86_400_000) {
            fin = new Date(fin.getTime() + 86_400_000);
          } else {
            erreurs.push({ feuille: nomFeuille, ligne: n, message: `rétablissement (${fin.toISOString().slice(0, 16)}) antérieur au début (${debut.toISOString().slice(0, 16)}) - ligne écartée` });
            return;
          }
        }
        const technoBrut = String(cell(row, 2) ?? '').trim();
        // « 2G/3G/4G » (toutes technos) → coupure SITE entier.
        const technologie = technoParDefaut ?? (technoBrut.includes('/') ? 'SITE' : (technoBrut || 'SITE'));
        const freq = String(cell(row, 3) ?? '').trim();
        lots.push({
          siteId,
          technologie: technologie.slice(0, 12),
          frequence: freq && freq !== '-' ? freq.slice(0, 30) : null,
          secteur: String(cell(row, 4) ?? '').trim().slice(0, 20) || null,
          dateDebut: debut,
          dateFin: fin,
          downtimeMinutes: fin ? minutesEntre(debut, fin) : null,
          heureContact: combiner(cell(row, 13), cell(row, 12)),
          technicienContacte: String(cell(row, 14) ?? '').trim().slice(0, 100) || null,
          dateArriveeSite: combiner(cell(row, 15), cell(row, 16)),
          intervenants: String(cell(row, 18) ?? '').trim().slice(0, 200) || null,
          cause: String(cell(row, 19) ?? '').trim().slice(0, 300) || null,
          actions: String(cell(row, 20) ?? '').trim().slice(0, 300) || null,
          typeAlarme: String(cell(row, 21) ?? '').trim().slice(0, 10).toUpperCase() || null,
          nocEngineer: String(cell(row, 23) ?? '').trim().slice(0, 100) || null,
          observations: String(cell(row, 22) ?? '').trim() || null,
        });
      }
    };

    // Lecture EN FLUX : le classeur NOC contient des feuilles énormes (« Data »
    // déclarée sur toute la grille Excel) — le chargement complet dépassait la
    // limite mémoire du conteneur (1 Go) et faisait tomber l'API (502).
    // Ici : ligne à ligne (~90 Mo de pointe), feuilles inutiles ignorées.
    // Seule la feuille « Events » fait foi (décision métier) — les autres
    // feuilles du classeur sont parcourues sans être importées.
    const FEUILLES: Record<string, string | null> = { Events: null };
    const lecteur = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(req.file.buffer), {
      entries: 'emit', sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'ignore', worksheets: 'emit',
    });
    for await (const ws of lecteur) {
      const nomFeuille = (ws as unknown as { name?: string }).name ?? '';
      const utile = nomFeuille in FEUILLES;
      for await (const row of ws) {
        if (!utile) continue; // itération nécessaire pour avancer le flux, rien n'est stocké
        traiterLigne(nomFeuille, FEUILLES[nomFeuille], row as unknown as LigneXlsx);
      }
    }
    if (!lots.length && !nonApparies.size) throw new AppError("Aucune feuille « Events » / « SITES HUAWEI » exploitable", 400);

    // Nettoyage des valeurs textuelles parasites du rapport (« - », « N/A », « #N/A »).
    for (const l of lots) {
      for (const k of ['technicienContacte', 'intervenants', 'cause', 'actions', 'typeAlarme', 'nocEngineer', 'observations'] as const) {
        const v = l[k];
        if (typeof v === 'string' && ['-', 'N/A', '#N/A', ''].includes(v.trim())) l[k] = null;
      }
    }

    // UN site = UNE coupure SITE ouverte, quelle que soit la source : une ligne
    // SITE encore EN COURS dont le site a déjà une coupure SITE ouverte (le plus
    // souvent la détection AUTO, horodatée par l'OSS à une heure différente du
    // rapport) créait une SECONDE ligne - et le site comptait double dans les
    // héritées du regroupement. Ces lignes sont sautées : la panne est déjà
    // suivie, l'OSS la clôturera à la reconnexion.
    let dejaCouvertes = 0;
    {
      const lignesSiteOuvertes = lots.filter((l) => l.technologie === 'SITE' && !(l.dateFin instanceof Date));
      if (lignesSiteOuvertes.length) {
        const sitesDejaOuverts = new Set((await prisma.coupureReseau.findMany({
          where: {
            technologie: 'SITE', dateFin: null,
            siteId: { in: [...new Set(lignesSiteOuvertes.map((l) => String(l.siteId)))] },
          },
          select: { siteId: true },
        })).map((c) => c.siteId));
        if (sitesDejaOuverts.size) {
          const avant = lots.length;
          const gardees = lots.filter((l) =>
            !(l.technologie === 'SITE' && !(l.dateFin instanceof Date) && sitesDejaOuverts.has(String(l.siteId))));
          lots.length = 0; lots.push(...gardees);
          dejaCouvertes = avant - lots.length;
        }
      }
    }

    // createMany + skipDuplicates : l'index d'unicité absorbe le ré-import.
    for (let i = 0; i < lots.length; i += 500) {
      try {
        const res2 = await prisma.coupureReseau.createMany({
          data: lots.slice(i, i + 500) as never,
          skipDuplicates: true,
        });
        crees += res2.count;
      } catch (e) {
        // Une contrainte d'intégrité (CHECK/FK) rejette TOUT le lot de 500 :
        // remonter un 422 détaillé plutôt qu'un « erreur interne » muet.
        const detail = e instanceof Error ? e.message.split('\n').pop() : String(e);
        logger.error(`[coupures] import rejeté par la base (lignes ${i + 1}–${i + 500}):`, e);
        throw new AppError(
          `Import refusé par les contraintes d'intégrité (lignes ${i + 1}–${Math.min(i + 500, lots.length)} du lot préparé) : ${detail}`,
          422
        );
      }
    }
    doublons = lots.length - crees;

    // Apurement au ré-import : une coupure déjà en base ENCORE OUVERTE dont le
    // rapport apporte désormais la date de rétablissement est CLÔTURÉE (fin +
    // downtime recalculé, infos d'intervention reprises). Le stock d'obsolètes
    // se résorbe donc en ré-important simplement le dernier rapport NOC.
    let clotureesParImport = 0;
    let incidentsResolus = 0;
    const avecFin = lots.filter((l) => l.dateFin instanceof Date);
    if (avecFin.length) {
      const ouvertes = await prisma.coupureReseau.findMany({
        where: { dateFin: null, siteId: { in: [...new Set(avecFin.map((l) => String(l.siteId)))] } },
        select: { id: true, siteId: true, technologie: true, frequence: true, dateDebut: true, incidentId: true },
      });
      const cleDe = (siteId: string, techno: string, freq: string | null, debut: Date) =>
        `${siteId}|${techno}|${freq ?? '-'}|${debut.getTime()}`;
      const parCle = new Map(ouvertes.map((o) => [cleDe(o.siteId, o.technologie, o.frequence, o.dateDebut), o.id]));
      const maj: { id: string; data: Record<string, unknown> }[] = [];
      for (const l of avecFin) {
        const id = parCle.get(cleDe(String(l.siteId), String(l.technologie), (l.frequence as string | null), l.dateDebut as Date));
        if (!id) continue;
        parCle.delete(cleDe(String(l.siteId), String(l.technologie), (l.frequence as string | null), l.dateDebut as Date));
        maj.push({
          id,
          data: {
            dateFin: l.dateFin,
            downtimeMinutes: minutesEntre(l.dateDebut as Date, l.dateFin as Date),
            ...(l.cause ? { cause: l.cause } : {}),
            ...(l.actions ? { actions: l.actions } : {}),
            ...(l.intervenants ? { intervenants: l.intervenants } : {}),
            ...(l.dateArriveeSite ? { dateArriveeSite: l.dateArriveeSite } : {}),
          },
        });
      }
      // Incidents des coupures apurées : à reboucler après la clôture. Sans ce
      // rebouclage — le trou exact du scénario « le site remonte via le rapport,
      // personne ne va sur site » — l'incident restait OUVERT à perpétuité,
      // avec escalade horaire et SMS de situation sans fin.
      const finParIncident = new Map<string, Date>();
      const incidentDeCoupure = new Map(ouvertes.map((o) => [o.id, o.incidentId]));
      for (const m of maj) {
        const incId = incidentDeCoupure.get(m.id);
        const fin = m.data.dateFin as Date;
        if (!incId || !(fin instanceof Date)) continue;
        const deja = finParIncident.get(incId);
        if (!deja || fin > deja) finParIncident.set(incId, fin); // la DERNIÈRE remontée fait foi
      }

      for (let i = 0; i < maj.length; i += 100) {
        await prisma.$transaction(
          maj.slice(i, i + 100).map((m) => prisma.coupureReseau.update({ where: { id: m.id }, data: m.data }))
        );
      }
      clotureesParImport = maj.length;

      for (const [incId, fin] of finParIncident) {
        const resolu = await prisma.$transaction((tx) => resoudreIncidentSiPlusDeCoupure(tx, incId, fin));
        if (resolu) { incidentsResolus++; void notifierResolutionAutomatique(incId); }
      }
    }

    // Reclassement des impacts d'aval AVANT le rattachement : les lignes de même
    // fenêtre dont un site amont figure dans le groupe deviennent HÉRITÉES →
    // un seul incident sera créé, sur le site origine.
    // reduce (pas de spread) : Math.min(...tableau) dépasse la pile d'appels
    // au-delà de ~100 000 lignes.
    const plusAncien = lots.reduce<number | null>((min, l) => {
      const t = (l.dateDebut as Date).getTime();
      return min == null || t < min ? t : min;
    }, null);
    const heriteesDetectees = await detecterHeriteesImport(plusAncien != null ? new Date(plusAncien) : undefined);

    // Les coupures importées ENCORE EN COURS obtiennent leur incident terrain
    // (groupé par site) — l'historique déjà rétabli n'en crée jamais.
    const incidentsCrees = await rattacherIncidentsCoupures(
      req.user!.id,
      [...new Set(lots.map((l) => String(l.siteId)))]
    );

    await auditLog(req.user!.id, 'CREATE', 'coupure_reseau', undefined, { import: true, crees, doublons, clotureesParImport, incidentsResolus, heriteesDetectees, incidentsCrees }, req);
    emettreCoupuresChangees({ action: 'import' });
    res.json({
      success: true,
      data: {
        lignes: lots.length,
        crees,
        doublonsIgnores: doublons + dejaCouvertes,
        dejaCouvertesParDetection: dejaCouvertes,
        clotureesParImport,
        incidentsResolus,
        heriteesDetectees,
        incidentsCrees,
        sitesNonApparies: [...nonApparies.entries()].map(([site, lignes]) => ({ site, lignes })).sort((a, b) => b.lignes - a.lignes),
        erreurs: erreurs.slice(0, 50),
      },
    });
  } catch (err) { next(err); }
}

// ── Rapport de disponibilité réseau ─────────────────────────────────────────

async function calculerDisponibiliteReseau(req: Request) {
    const mois = req.query.mois ? Math.max(1, Math.min(24, parseInt(String(req.query.mois), 10))) : 3;
    const maintenant = new Date();
    // Période libre (date_debut/date_fin, jours en UTC comme les heures NOC) :
    // remplace la fenêtre glissante en mois. Une fin future est ramenée à
    // maintenant — le futur n'a pas de downtime et fausserait la dispo %.
    const duQ = req.query.date_debut ? new Date(`${String(req.query.date_debut)}T00:00:00.000Z`) : null;
    const auQ = req.query.date_fin ? new Date(`${String(req.query.date_fin)}T23:59:59.999Z`) : null;
    const libre = !!(duQ && auQ && !Number.isNaN(duQ.getTime()) && !Number.isNaN(auQ.getTime()));
    let depuis: Date;
    let finFenetre = maintenant;
    if (libre) {
      if (auQ! <= duQ!) throw new AppError('Période invalide : la date de fin doit suivre le début', 422);
      if (duQ! >= maintenant) throw new AppError('Période invalide : le début est dans le futur', 422);
      depuis = duQ!;
      finFenetre = auQ! < maintenant ? auQ! : maintenant;
    } else {
      depuis = new Date(); depuis.setMonth(depuis.getMonth() - mois); depuis.setHours(0, 0, 0, 0);
    }
    const fenetreMin = minutesEntre(depuis, finFenetre);

    // Filtres facultatifs. Technologies : une coupure SITE coupe TOUTES les
    // technos, elle est donc toujours incluse dès qu'une techno est demandée.
    // Alarmes : les coupures SANS type (dont les AUTO OSS) sont exclues par ce
    // filtre — c'est le comportement attendu (« montre-moi les FO »).
    const TECHNOS_VALIDES = new Set(['SITE', '2G', '3G', '4G', '5G']);
    const technosSel = String(req.query.technologies ?? '')
      .split(',').map((t) => t.trim().toUpperCase()).filter((t) => TECHNOS_VALIDES.has(t));
    const alarmesSel = String(req.query.alarmes ?? '')
      .split(',').map((a) => a.trim().toUpperCase()).filter(Boolean);

    // Périmètre : un prestataire ne voit que la disponibilité de SES lots ;
    // les internes (NOC/direction) voient tout + la déclinaison par prestataire.
    const perimetre = await sitePerimetre(req.user!.id);
    const restreint = isRestreint(perimetre);
    const whereSite = { isActive: true, ...(restreint ? perimetre : {}) };

    const [coupures, nbSites, lots] = await Promise.all([
      prisma.coupureReseau.findMany({
        where: {
          OR: [{ dateFin: null }, { dateFin: { gte: depuis } }],
          dateDebut: { lte: finFenetre },
          // Règle validée avec l'exploitant : une détection AUTO (OSS) ne compte
          // dans le rapport OFFICIEL qu'une fois PRISE EN CHARGE par le NOC.
          // Les brutes restent un sas d'attente — visibles sur la liste et la
          // carte, sans peser sur la dispo publiée ni sur les prestataires.
          AND: [{ OR: [{ source: { not: 'OSS' } }, { priseEnChargePar: { not: null } }] }],
          ...(technosSel.length ? { technologie: { in: [...new Set([...technosSel, 'SITE'])] } } : {}),
          ...(alarmesSel.length ? { typeAlarme: { in: alarmesSel } } : {}),
          ...(restreint ? { site: perimetre } : {}),
        },
        // `select` explicite : l'`include` seul ramenait TOUTES les colonnes,
        // dont `observations` (text illimité) — 1 Ko par ligne au lieu de 200 o.
        select: {
          siteId: true, dateDebut: true, dateFin: true, typeAlarme: true,
          causeCategorie: true, origine: true,
          site: { select: { id: true, nom: true, region: true, lotId: true } },
        },
      }),
      prisma.site.count({ where: whereSite }),
      restreint ? Promise.resolve([]) : prisma.lot.findMany({
        select: {
          id: true,
          _count: { select: { sites: { where: { isActive: true } } } },
          assignments: { select: { prestataireId: true, scope: true, prestataire: { select: { nom: true } } } },
        },
      }),
    ]);

    // ⚠️ Le rapport NOC produit UNE LIGNE PAR TECHNOLOGIE pour une même panne :
    // toutes les durées passent donc par une UNION D'INTERVALLES par site avant
    // d'être sommées (sinon un site entier coupé 6 h comptait 24 h).
    const ivSite = new Map<string, Intervalle[]>();
    const ivEnergie = new Map<string, Intervalle[]>();
    const ivActif = new Map<string, Intervalle[]>();
    const ivPassif = new Map<string, Intervalle[]>();
    const ivAlarme = new Map<string, Intervalle[]>(); // clé « alarme|site »
    const parSite = new Map<string, { nom: string; region: string; downtime: number; coupures: number; enCours: number }>();
    const parAlarme = new Map<string, { type: string; coupures: number; downtime: number }>();
    const ENERGIE = new Set(['AE', 'GE', 'EN']);
    let enCours = 0;

    // Évaluation par prestataire (vue interne) : agrégats sur les sites de ses lots.
    interface EvalPresta {
      nom: string; nbSites: number; coupures: number; enCours: number; sitesTouches: Set<string>;
      iv: Map<string, Intervalle[]>; ivActif: Map<string, Intervalle[]>; ivPassif: Map<string, Intervalle[]>; ivNonClasse: Map<string, Intervalle[]>;
    }
    const parPresta = new Map<string, EvalPresta>();
    const prestasDuLot = new Map<string, { prestataireId: string; nom: string }[]>();
    for (const lot of lots) {
      const uniques = new Map<string, string>();
      for (const a of lot.assignments) uniques.set(a.prestataireId, a.prestataire.nom);
      prestasDuLot.set(lot.id, [...uniques.entries()].map(([prestataireId, nom]) => ({ prestataireId, nom })));
      for (const [prestataireId, nom] of uniques) {
        const e = parPresta.get(prestataireId) ?? {
          nom, nbSites: 0, coupures: 0, enCours: 0, sitesTouches: new Set<string>(),
          iv: new Map<string, Intervalle[]>(), ivActif: new Map<string, Intervalle[]>(),
          ivPassif: new Map<string, Intervalle[]>(), ivNonClasse: new Map<string, Intervalle[]>(),
        };
        e.nbSites += lot._count.sites;
        parPresta.set(prestataireId, e);
      }
    }

    for (const c of coupures) {
      // Downtime borné à la fenêtre d'analyse : une coupure ouverte court
      // jusqu'à la fin de fenêtre (= maintenant, sauf période libre passée).
      const debut = c.dateDebut < depuis ? depuis : c.dateDebut;
      const finBrute = c.dateFin ?? finFenetre;
      const fin = finBrute > finFenetre ? finFenetre : finBrute;
      if (fin <= depuis || debut >= fin) continue;
      const iv: Intervalle = { debut, fin };
      if (!c.dateFin) enCours++;
      pousser(ivSite, c.siteId, iv);
      if (c.typeAlarme && ENERGIE.has(c.typeAlarme)) pousser(ivEnergie, c.siteId, iv);
      if (c.causeCategorie === 'ACTIF') pousser(ivActif, c.siteId, iv);
      else if (c.causeCategorie === 'PASSIF') pousser(ivPassif, c.siteId, iv);

      const ps = parSite.get(c.siteId) ?? { nom: c.site.nom, region: c.site.region, downtime: 0, coupures: 0, enCours: 0 };
      ps.coupures += 1; if (!c.dateFin) ps.enCours += 1;
      parSite.set(c.siteId, ps);

      // Sans type et « NA » (non attribué) fusionnent sous N/A — même sens.
      const ta = (!c.typeAlarme || c.typeAlarme === 'NA') ? 'N/A' : c.typeAlarme;
      const pa = parAlarme.get(ta) ?? { type: ta, coupures: 0, downtime: 0 };
      pa.coupures += 1; parAlarme.set(ta, pa);
      pousser(ivAlarme, `${ta}|${c.siteId}`, iv);

      // L'imputation par prestataire EXCLUT les coupures héritées : l'aval d'une
      // panne amont n'est pas de la responsabilité du prestataire du site aval
      // (le downtime global, lui, les compte — l'indisponibilité est réelle).
      if (c.site.lotId && c.origine !== 'HERITEE') {
        for (const { prestataireId } of prestasDuLot.get(c.site.lotId) ?? []) {
          const e = parPresta.get(prestataireId);
          if (!e) continue;
          e.coupures += 1; if (!c.dateFin) e.enCours += 1;
          pousser(e.iv, c.siteId, iv);
          if (c.causeCategorie === 'ACTIF') pousser(e.ivActif, c.siteId, iv);
          else if (c.causeCategorie === 'PASSIF') pousser(e.ivPassif, c.siteId, iv);
          else pousser(e.ivNonClasse, c.siteId, iv);
          e.sitesTouches.add(c.siteId);
        }
      }
    }

    // Unions par site puis somme : une panne listée sur 4 technologies ne compte
    // qu'une fois.
    const downtimeTotal = minutesUnionParCle(ivSite);
    const downtimeEnergie = minutesUnionParCle(ivEnergie);
    const downtimeActif = minutesUnionParCle(ivActif);
    const downtimePassif = minutesUnionParCle(ivPassif);
    for (const [siteId, ps] of parSite) ps.downtime = minutesUnion(ivSite.get(siteId) ?? []);
    for (const [ta, pa] of parAlarme) {
      pa.downtime = [...ivAlarme.entries()]
        .filter(([k]) => k.startsWith(`${ta}|`))
        .reduce((s, [, liste]) => s + minutesUnion(liste), 0);
    }
    const nonClasse = Math.max(0, downtimeTotal - downtimeActif - downtimePassif);
    // Liste COMPLÈTE triée (la page n'affiche que le top 15, l'export prend tout).
    const sitesTous = [...parSite.values()]
      .map((s) => ({ ...s, downtimeHeures: Math.round(s.downtime / 60), dispoPct: Math.max(0, Math.round((1 - s.downtime / fenetreMin) * 1000) / 10) }))
      .sort((a, b) => b.downtime - a.downtime);
    const donnees = {
        periodeMois: mois,
        periodeLibre: libre,
        periodeLibelle: libre
          ? `du ${depuis.toLocaleDateString('fr-FR', { timeZone: 'UTC' })} au ${finFenetre.toLocaleDateString('fr-FR', { timeZone: 'UTC' })}`
          : `sur ${mois} mois`,
        perimetreRestreint: restreint,
        kpis: {
          coupures: coupures.filter((c) => (c.dateFin ?? finFenetre) > depuis && c.dateDebut < finFenetre).length,
          enCours,
          downtimeHeures: Math.round(downtimeTotal / 60),
          partEnergiePct: downtimeTotal > 0 ? Math.round((downtimeEnergie / downtimeTotal) * 100) : 0,
          // Split par responsabilité : ACTIF (radio/transmission), PASSIF (énergie/environnement).
          downtimeActifHeures: Math.round(downtimeActif / 60),
          downtimePassifHeures: Math.round(downtimePassif / 60),
          downtimeNonClasseHeures: Math.round(nonClasse / 60),
          partPassifPct: downtimeTotal > 0 ? Math.round((downtimePassif / downtimeTotal) * 100) : 0,
          sitesTouches: parSite.size,
          nbSites,
        },
        topSites: sitesTous.slice(0, 15),
        parTypeAlarme: [...parAlarme.values()]
          .map((a) => ({ ...a, downtimeHeures: Math.round(a.downtime / 60) }))
          .sort((a, b) => b.downtime - a.downtime),
        // Vue interne uniquement : évaluation de chaque prestataire sur son périmètre.
        parPrestataire: restreint ? undefined : [...parPresta.values()]
          .map((e) => {
            const dt = minutesUnionParCle(e.iv);
            return {
              nom: e.nom,
              nbSites: e.nbSites,
              coupures: e.coupures,
              enCours: e.enCours,
              sitesTouches: e.sitesTouches.size,
              downtimeHeures: Math.round(dt / 60),
              downtimeActifHeures: Math.round(minutesUnionParCle(e.ivActif) / 60),
              downtimePassifHeures: Math.round(minutesUnionParCle(e.ivPassif) / 60),
              downtimeNonClasseHeures: Math.round(minutesUnionParCle(e.ivNonClasse) / 60),
              // Dispo moyenne du parc du prestataire (minutes site×fenêtre).
              dispoPct: e.nbSites > 0 ? Math.max(0, Math.round((1 - dt / (fenetreMin * e.nbSites)) * 1000) / 10) : 100,
            };
          })
          .sort((a, b) => b.downtimeHeures - a.downtimeHeures),
    };
    return { donnees, sitesTous, technosSel, alarmesSel };
}

export async function getDisponibiliteReseau(req: Request, res: Response, next: NextFunction) {
  try {
    const { donnees } = await calculerDisponibiliteReseau(req);
    res.json({ success: true, data: donnees });
  } catch (err) { next(err); }
}

/**
 * PRISE EN CHARGE d'une coupure (typiquement une détection AUTO OSS) : le NOC
 * adopte l'événement, et le système raisonne sur la TOPOLOGIE :
 *   1. il remonte la chaîne de transmission — le site le plus HAUT ayant une
 *      coupure SITE ouverte est la racine réelle (une rafale de détections
 *      AUTO sur un axe est presque toujours UNE panne amont) ;
 *   2. toutes les coupures SITE ouvertes de l'aval de cette racine (y compris
 *      celle cliquée si elle n'est pas la racine) sont reclassées HÉRITÉES —
 *      la liste retombe à un événement racine, l'imputation SLA est juste ;
 *   3. la racine est marquée prise en charge (qui / quand).
 * Les coupures déjà liées à un incident ne sont pas touchées.
 */
export async function prendreEnChargeCoupure(req: Request, res: Response, next: NextFunction) {
  try {
    const coupure = await prisma.coupureReseau.findUnique({
      where: { id: req.params.id },
      select: { id: true, siteId: true, dateFin: true, technologie: true, dateDebut: true },
    });
    if (!coupure) throw new AppError('Coupure introuvable', 404);
    if (coupure.dateFin) throw new AppError('Coupure déjà rétablie - rien à prendre en charge', 422);
    // Créer les héritées pour l'aval SANS détection propre (sites non
    // rapprochés OSS) : activé par défaut — c'est ce qui rend la dispo juste.
    const creerAvalManquant = (req.body as { creerAvalManquant?: boolean })?.creerAvalManquant !== false;
    // Armement PAR VALIDATION HUMAINE : la prise en charge peut déclencher le
    // terrain (incident CRITIQUE + SMS passifs + push techniciens). Décoché par
    // défaut : la passerelle SMS est réelle, le NOC choisit en connaissance.
    const creerIncident = (req.body as { creerIncident?: boolean })?.creerIncident === true;

    const sites = await prisma.site.findMany({
      where: { isActive: true },
      select: { id: true, nom: true, parentTransmissionId: true },
    });
    const parId = new Map(sites.map((s) => [s.id, s]));

    // 1. Racine = le plus haut ancêtre (chaîne amont, ≤30 sauts) qui a une
    //    coupure SITE ouverte. Par défaut : la coupure cliquée elle-même.
    let racine = coupure;
    let cursor = parId.get(coupure.siteId)?.parentTransmissionId ?? null;
    for (let saut = 0; cursor && saut < 30; saut++) {
      const coupAmont = await prisma.coupureReseau.findFirst({
        where: { siteId: cursor, technologie: 'SITE', dateFin: null },
        orderBy: { dateDebut: 'asc' },
        select: { id: true, siteId: true, dateFin: true, technologie: true, dateDebut: true },
      });
      if (coupAmont) racine = coupAmont;
      cursor = parId.get(cursor)?.parentTransmissionId ?? null;
    }

    // 2. Aval de la racine (BFS sur parentTransmissionId).
    const enfants = new Map<string, string[]>();
    for (const s of sites) {
      if (!s.parentTransmissionId) continue;
      const l = enfants.get(s.parentTransmissionId); if (l) l.push(s.id); else enfants.set(s.parentTransmissionId, [s.id]);
    }
    const avalIds: string[] = [];
    const file = [racine.siteId];
    while (file.length) {
      const id = file.shift()!;
      for (const e of enfants.get(id) ?? []) { avalIds.push(e); file.push(e); }
    }

    const moi = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { nom: true, prenom: true } });
    const nom = [moi?.prenom, moi?.nom].filter(Boolean).join(' ') || 'NOC';
    const quand = new Date();

    // L'adoption couvre TOUT l'événement : la racine, les locales reclassées
    // et les héritées déjà rattachées — c'est elle qui les fait entrer au
    // rapport officiel (règle « AUTO comptée seulement si prise en charge »).
    const reclassees = avalIds.length
      ? await prisma.coupureReseau.updateMany({
          where: {
            siteId: { in: avalIds }, technologie: 'SITE', dateFin: null,
            origine: 'LOCALE', incidentId: null, id: { not: racine.id },
          },
          data: { origine: 'HERITEE', coupureOrigineId: racine.id, priseEnChargePar: nom, priseEnChargeLe: quand },
        })
      : { count: 0 };
    // Héritées ORPHELINES : encore ouvertes mais accrochées à une racine déjà
    // clôturée (rebond de l'amont) - ré-adoptées par la racine courante.
    const orphelines = avalIds.length
      ? await prisma.coupureReseau.updateMany({
          where: {
            siteId: { in: avalIds }, technologie: 'SITE', dateFin: null,
            origine: 'HERITEE', incidentId: null,
            id: { not: racine.id }, coupureOrigineId: { not: racine.id },
            coupureOrigine: { dateFin: { not: null } },
          },
          data: { coupureOrigineId: racine.id, priseEnChargePar: nom, priseEnChargeLe: quand },
        })
      : { count: 0 };
    // Héritées de RANG 2 : accrochées à une coupure AVAL encore ouverte (nées
    // ainsi par l'ordre de parcours du flux OSS quand la racine est parsée en
    // dernier). Remontées à la racine : sans ça elles n'apparaissent pas dans
    // les « impactés » de la racine et surtout ÉCHAPPENT à l'estampille
    // d'adoption — donc au rapport NOC et à la disponibilité.
    const imbriquees = avalIds.length
      ? await prisma.coupureReseau.updateMany({
          where: {
            siteId: { in: avalIds }, technologie: 'SITE', dateFin: null,
            origine: 'HERITEE', incidentId: null,
            id: { not: racine.id }, coupureOrigineId: { not: racine.id },
            coupureOrigine: { dateFin: null, siteId: { in: avalIds } },
          },
          data: { coupureOrigineId: racine.id, priseEnChargePar: nom, priseEnChargeLe: quand },
        })
      : { count: 0 };
    await prisma.coupureReseau.updateMany({
      where: { coupureOrigineId: racine.id, dateFin: null, priseEnChargePar: null },
      data: { priseEnChargePar: nom, priseEnChargeLe: quand },
    });

    // Héritées MANQUANTES : sites aval sans coupure ouverte (pas de nodeId →
    // l'OSS ne les voit pas) — leur indisponibilité doit exister et compter.
    let heriteesCreees = 0;
    if (creerAvalManquant && avalIds.length) {
      const couverts = new Set(
        (await prisma.coupureReseau.findMany({
          where: { siteId: { in: avalIds }, technologie: 'SITE', dateFin: null },
          select: { siteId: true },
        })).map((c) => c.siteId)
      );
      const manquants = avalIds.filter((id) => !couverts.has(id));
      if (manquants.length) {
        const crees = await prisma.coupureReseau.createMany({
          data: manquants.map((siteId) => ({
            siteId,
            technologie: 'SITE',
            origine: 'HERITEE',
            source: 'OSS',
            coupureOrigineId: racine.id,
            dateDebut: racine.dateDebut,
            nocEngineer: nom,
            priseEnChargePar: nom,
            priseEnChargeLe: quand,
            observations: 'Héritée créée à la prise en charge - site aval sans détection OSS propre.',
          })),
          // Index unique (site, technologie, fréquence, début) posé en SQL par
          // la migration 0029 : une héritée DÉJÀ CLÔTURÉE au même instant
          // (prise en charge annulée, cycle panne/rétablissement) faisait
          // tomber tout l'appel en conflit - on saute simplement le doublon.
          skipDuplicates: true,
        });
        heriteesCreees = crees.count;
      }
    }

    // Trace : qui a pris en charge, quand — le nom remplace AUTO-OSS.
    await prisma.coupureReseau.update({
      where: { id: racine.id },
      data: { priseEnChargePar: nom, priseEnChargeLe: quand, nocEngineer: nom },
    });

    // ── Déclenchement terrain (optionnel) : incident sur la RACINE ──────────
    // Une panne = un incident, même logique que l'import NOC (verrou par site,
    // réutilisation d'un incident encore ouvert). Site entier uniquement.
    let incidentInfo: { id: string; reference: string | null; reutilise: boolean } | null = null;
    if (creerIncident) {
      const racineFull = await prisma.coupureReseau.findUnique({
        where: { id: racine.id },
        select: { siteId: true, dateDebut: true, dateFin: true, technologie: true, site: { select: { nom: true } } },
      });
      if (racineFull && !racineFull.dateFin && racineFull.technologie === 'SITE') {
        const { incident, cree } = await avecRattrapageReferenceInc(() => prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'inc:' + racineFull.siteId})::bigint)`;
          const existant = await tx.incident.findFirst({
            where: { siteId: racineFull.siteId, statut: { in: ['OUVERT', 'EN_COURS'] }, coupures: { some: { dateFin: null } } },
            select: { id: true, reference: true },
          });
          if (existant) {
            await tx.coupureReseau.update({ where: { id: racine.id }, data: { incidentId: existant.id } });
            return { incident: existant, cree: false };
          }
          const nouveau = await tx.incident.create({
            data: {
              reference: await genererReference(tx, 'INC', new Date()),
              siteId: racineFull.siteId,
              type: 'COUPURE_TOTALE',
              severite: 'CRITIQUE',
              description: `Site entier hors service - détection OSS prise en charge par ${nom}.`,
              declarePar: req.user!.id,
              // Même règle qu'à la saisie NOC : l'incident s'ouvre au début
              // réel de la panne (la détection OSS peut précéder l'adoption
              // de plusieurs heures) — MTTR honnête, résolution ≥ ouverture.
              dateOuverture: new Date(Math.min(racineFull.dateDebut.getTime(), Date.now())),
            },
            select: { id: true, reference: true },
          });
          await tx.coupureReseau.update({ where: { id: racine.id }, data: { incidentId: nouveau.id } });
          return { incident: nouveau, cree: true };
        }));
        incidentInfo = { ...incident, reutilise: !cree };
        if (cree) {
          io.of('/supervision').emit('incident:created', { id: incident.id, siteId: racineFull.siteId });
          // SITES distincts, pas lignes : un site à deux coupures ouvertes
          // (OSS + rapport) comptait double dans le SMS.
          const nbAval = (await prisma.coupureReseau.findMany({
            where: { coupureOrigineId: racine.id, dateFin: null },
            select: { siteId: true }, distinct: ['siteId'],
          })).length;
          const s = nbAval > 1 ? 's' : '';
          await notifierIncidentCoupure(
            racineFull.siteId,
            rendreTemplate('sms.tpl.siteHorsService', {
              site: racineFull.site.nom,
              reference: incident.reference ?? '',
              impactes: nbAval ? ` (+${nbAval} site${s} aval impacté${s})` : '',
            }),
            'INCIDENT_COUPURE_NOC',
            'PASSIVE'
          );
          // Push gratuit aux techniciens passifs du lot, comme l'import NOC.
          try {
            const lot = await prisma.site.findUnique({
              where: { id: racineFull.siteId },
              select: { lot: { select: { assignments: { select: { prestataireId: true, scope: true } } } } },
            });
            const prestas = (lot?.lot?.assignments ?? []).filter((a) => a.scope !== 'ACTIVE').map((a) => a.prestataireId);
            if (prestas.length) {
              const techs = await prisma.user.findMany({
                where: { role: 'TECHNICIEN', isActive: true, prestataireId: { in: prestas } },
                select: { id: true },
              });
              await Promise.all(techs.map((t) => notificationService.sendToUser(t.id, {
                title: `🔴 ${racineFull.site.nom} hors service`,
                body: `Incident ${incident.reference ?? ''} créé à la prise en charge NOC - intervention terrain requise.`,
                data: { incidentId: incident.id, type: 'incident' },
              })));
            }
          } catch (e) { logger.warn('[coupures] push technicien (prise en charge) échoué:', e); }
        }
      }
    }

    await auditLog(req.user!.id, 'UPDATE', 'coupure_reseau', racine.id, {
      priseEnCharge: true, depuisCoupure: coupure.id, heriteesReclassees: reclassees.count + orphelines.count + imbriquees.count, heriteesCreees,
      incidentCree: incidentInfo && !incidentInfo.reutilise ? incidentInfo.id : undefined,
      incidentReutilise: incidentInfo?.reutilise ? incidentInfo.id : undefined,
    }, req);
    emettreCoupuresChangees({ action: 'priseEnCharge', racineId: racine.id });
    res.json({
      success: true,
      data: {
        racineId: racine.id,
        racineSiteNom: parId.get(racine.siteId)?.nom ?? '—',
        estRacine: racine.id === coupure.id,
        heriteesReclassees: reclassees.count + orphelines.count + imbriquees.count,
        heriteesCreees,
        priseEnChargePar: nom,
        incident: incidentInfo,
      },
    });
  } catch (err) { next(err); }
}

/**
 * ANNULATION d'une prise en charge erronée : défait proprement ce que la
 * prise en charge a fait, pour revenir à l'état « sas brut » et permettre
 * une nouvelle analyse depuis la bonne coupure :
 *   - les héritées FABRIQUÉES pour l'aval aveugle (créées par la prise en
 *     charge, reconnaissables à leur observation) sont SUPPRIMÉES ;
 *   - les autres héritées ouvertes de la racine redeviennent LOCALES
 *     (une prise en charge correcte les re-classera) ;
 *   - l'estampille d'adoption est retirée partout (la racine ressort du
 *     rapport officiel si elle est d'origine OSS).
 * Les héritées déjà rétablies ne sont pas touchées (historique).
 */
const MARQUE_HERITEE_FABRIQUEE = 'Héritée créée à la prise en charge';
export async function annulerPriseEnCharge(req: Request, res: Response, next: NextFunction) {
  try {
    const cliquee = await prisma.coupureReseau.findUnique({
      where: { id: req.params.id },
      select: { id: true, origine: true, coupureOrigineId: true, priseEnChargePar: true, source: true },
    });
    if (!cliquee) throw new AppError('Coupure introuvable', 404);
    // Depuis une héritée, on remonte à la racine porteuse de l'adoption.
    const racineId = cliquee.origine === 'HERITEE' && cliquee.coupureOrigineId ? cliquee.coupureOrigineId : cliquee.id;
    const racine = await prisma.coupureReseau.findUnique({
      where: { id: racineId },
      select: { id: true, priseEnChargePar: true, source: true, incidentId: true },
    });
    if (!racine?.priseEnChargePar) throw new AppError("Cette coupure n'est pas prise en charge", 422);
    // Terrain déjà déclenché (incident + SMS partis) : annuler l'adoption
    // sortirait la coupure du rapport en laissant l'incident actif - traiter
    // l'incident d'abord (le clôturer ou le supprimer), puis annuler.
    if (racine.incidentId) {
      throw new AppError(
        "Un incident terrain est rattaché à cette prise en charge - clôturez ou supprimez l'incident avant d'annuler l'adoption.",
        422
      );
    }

    const [supprimees, redeclassees] = await prisma.$transaction([
      prisma.coupureReseau.deleteMany({
        where: {
          coupureOrigineId: racine.id, dateFin: null, source: 'OSS', incidentId: null,
          observations: { startsWith: MARQUE_HERITEE_FABRIQUEE },
        },
      }),
      prisma.coupureReseau.updateMany({
        where: { coupureOrigineId: racine.id, dateFin: null },
        data: { origine: 'LOCALE', coupureOrigineId: null, priseEnChargePar: null, priseEnChargeLe: null },
      }),
      prisma.coupureReseau.update({
        where: { id: racine.id },
        data: {
          priseEnChargePar: null, priseEnChargeLe: null,
          ...(racine.source === 'OSS' ? { nocEngineer: 'AUTO-OSS' } : {}),
        },
      }),
    ]);

    await auditLog(req.user!.id, 'UPDATE', 'coupure_reseau', racine.id, {
      annulationPriseEnCharge: true, heriteesSupprimees: supprimees.count, heriteesRedeclassees: redeclassees.count,
    }, req);
    emettreCoupuresChangees({ action: 'annulationPriseEnCharge', racineId: racine.id });
    res.json({
      success: true,
      data: { racineId: racine.id, heriteesSupprimees: supprimees.count, heriteesRedeclassees: redeclassees.count },
    });
  } catch (err) { next(err); }
}

/**
 * Situation en direct pour la page Coupures : compteurs des onglets, bandeau
 * de synthèse et file « à qualifier » — périmètre prestataire appliqué.
 */
export async function getCoupuresStats(req: Request, res: Response, next: NextFunction) {
  try {
    const perimetre = await sitePerimetre(req.user!.id);
    const surSite = isRestreint(perimetre) ? { site: perimetre } : {};
    const ilYaUneHeure = new Date(Date.now() - 3600_000);
    const [enCours, enCoursSiteEntier, enCoursHeritees, terminees, nouvellesDerniereHeure, aQualifier, plusAncienne, enCoursAuto] =
      await Promise.all([
        prisma.coupureReseau.count({ where: { dateFin: null, ...surSite } }),
        prisma.coupureReseau.count({ where: { dateFin: null, technologie: 'SITE', ...surSite } }),
        prisma.coupureReseau.count({ where: { dateFin: null, origine: 'HERITEE', ...surSite } }),
        prisma.coupureReseau.count({ where: { dateFin: { not: null }, ...surSite } }),
        prisma.coupureReseau.count({ where: { dateDebut: { gte: ilYaUneHeure }, ...surSite } }),
        // RACINES seulement : une héritée n'a jamais d'alarme/classement
        // propres - les compter gonflait la tuile et divergeait de la liste
        // filtrée (qui ne montre que les racines).
        prisma.coupureReseau.count({
          where: { dateFin: null, origine: 'LOCALE', OR: [{ typeAlarme: null }, { causeCategorie: null }], ...surSite },
        }),
        prisma.coupureReseau.findFirst({
          where: { dateFin: null, origine: 'LOCALE', ...surSite },
          orderBy: { dateDebut: 'asc' },
          select: { dateDebut: true, technologie: true, site: { select: { nom: true } } },
        }),
        // Sas AUTO = détections OSS non encore prises en charge - RACINES
        // seulement, comme l'onglet qu'il compte (les héritées suivent leur
        // racine, elles ne sont pas « à traiter » individuellement).
        prisma.coupureReseau.count({ where: { dateFin: null, source: 'OSS', priseEnChargePar: null, origine: 'LOCALE', ...surSite } }),
      ]);
    res.json({
      success: true,
      data: {
        enCours, enCoursSiteEntier, enCoursHeritees, terminees, nouvellesDerniereHeure, aQualifier, plusAncienne,
        enCoursAuto,
        // Rapport NOC = racines manuelles + AUTO adoptées (aligné sur l'onglet).
        enCoursManuel: Math.max(0, enCours - enCoursHeritees - enCoursAuto),
      },
    });
  } catch (err) { next(err); }
}

/**
 * Export xlsx/PDF de la disponibilité réseau — mêmes filtres que la page
 * (période glissante ou libre, technologies, types d'alarme, périmètre) ;
 * la feuille Sites contient la liste COMPLÈTE, pas seulement le top 15.
 */
export async function exportDisponibiliteReseau(req: Request, res: Response, next: NextFunction) {
  try {
    const { donnees, sitesTous, technosSel, alarmesSel } = await calculerDisponibiliteReseau(req);
    const k = donnees.kpis;
    const sousTitre = [
      donnees.periodeLibelle,
      technosSel.length ? `technologies : ${technosSel.join(', ')}` : 'toutes technologies',
      alarmesSel.length ? `alarmes : ${alarmesSel.join(', ')}` : 'toutes alarmes',
      donnees.perimetreRestreint ? 'périmètre : vos lots' : 'réseau entier',
    ].join(' · ');

    const feuilles: TabularSheet[] = [
      {
        name: 'Synthèse',
        columns: [
          { header: 'Indicateur', key: 'indicateur', width: 38 },
          { header: 'Valeur', key: 'valeur', width: 22 },
        ],
        rows: [
          { indicateur: 'Coupures', valeur: k.coupures },
          { indicateur: 'Coupures en cours', valeur: k.enCours },
          { indicateur: 'Sites touchés', valeur: `${k.sitesTouches} / ${k.nbSites}` },
          { indicateur: 'Downtime cumulé (h)', valeur: k.downtimeHeures },
          { indicateur: 'Part énergie AE/GE/EN (%)', valeur: k.partEnergiePct },
          { indicateur: 'Downtime actif (h)', valeur: k.downtimeActifHeures },
          { indicateur: 'Downtime passif (h)', valeur: k.downtimePassifHeures },
          { indicateur: 'Downtime non classé (h)', valeur: k.downtimeNonClasseHeures },
        ],
      },
      // Clés UNIQUES d'une feuille à l'autre : le sélecteur de colonnes dédoublonne
      // par clé — avec « coupures » partagé entre 3 feuilles, il n'affichait
      // qu'une entrée et la sélection écrasait les colonnes homonymes.
      {
        name: 'Sites',
        columns: [
          { header: 'Site', key: 'siteNom', width: 26 },
          { header: 'Région', key: 'siteRegion', width: 16 },
          { header: 'Coupures', key: 'siteCoupures', width: 10 },
          { header: 'En cours', key: 'siteEnCours', width: 10 },
          { header: 'Downtime (h)', key: 'siteDowntimeHeures', width: 13 },
          { header: 'Dispo (%)', key: 'siteDispoPct', width: 10 },
        ],
        rows: sitesTous.map((s) => ({
          siteNom: s.nom, siteRegion: s.region, siteCoupures: s.coupures,
          siteEnCours: s.enCours, siteDowntimeHeures: s.downtimeHeures, siteDispoPct: s.dispoPct,
        })),
      },
      {
        name: 'Par alarme',
        columns: [
          { header: "Type d'alarme", key: 'alarmeType', width: 14 },
          { header: 'Coupures', key: 'alarmeCoupures', width: 10 },
          { header: 'Downtime (h)', key: 'alarmeDowntimeHeures', width: 13 },
        ],
        rows: donnees.parTypeAlarme.map((a) => ({
          alarmeType: a.type, alarmeCoupures: a.coupures, alarmeDowntimeHeures: a.downtimeHeures,
        })),
      },
    ];
    if (donnees.parPrestataire?.length) {
      feuilles.push({
        name: 'Prestataires',
        columns: [
          { header: 'Prestataire', key: 'prestaNom', width: 24 },
          { header: 'Sites', key: 'prestaNbSites', width: 8 },
          { header: 'Coupures', key: 'prestaCoupures', width: 10 },
          { header: 'Sites touchés', key: 'prestaSitesTouches', width: 12 },
          { header: 'Downtime (h)', key: 'prestaDowntimeHeures', width: 13 },
          { header: 'Passif (h)', key: 'prestaPassifHeures', width: 11 },
          { header: 'Actif (h)', key: 'prestaActifHeures', width: 11 },
          { header: 'Non classé (h)', key: 'prestaNonClasseHeures', width: 13 },
          { header: 'Dispo moyenne (%)', key: 'prestaDispoPct', width: 16 },
        ],
        rows: donnees.parPrestataire.map((p) => ({
          prestaNom: p.nom, prestaNbSites: p.nbSites, prestaCoupures: p.coupures,
          prestaSitesTouches: p.sitesTouches, prestaDowntimeHeures: p.downtimeHeures,
          prestaPassifHeures: p.downtimePassifHeures, prestaActifHeures: p.downtimeActifHeures,
          prestaNonClasseHeures: p.downtimeNonClasseHeures, prestaDispoPct: p.dispoPct,
        })),
      });
    }
    if (req.query.colonnes !== '?') {
      await auditLog(req.user!.id, 'EXPORT', 'coupure_reseau', undefined, { rapport: 'disponibilite-reseau', format: req.params.format, sites: sitesTous.length }, req);
    }
    await sendTabular(res, req.params.format, 'disponibilite-reseau', 'Disponibilité réseau', feuilles, sousTitre);
  } catch (err) { next(err); }
}

/**
 * Export des coupures (xlsx / PDF tabulaire) avec les MÊMES filtres que la
 * liste : période (date_debut/date_fin), statut, technologie, alarme,
 * recherche — et le périmètre prestataire appliqué comme partout.
 */
export async function exportCoupures(req: Request, res: Response, next: NextFunction) {
  try {
    // Sélecteur de colonnes du web : liste des colonnes disponibles (feuille Détail).
    if (req.query.colonnes === '?') {
      return res.json({
        success: true,
        data: [{ feuille: 'Détail', colonnes: COLONNES_DETAIL.map((c) => ({ key: c.key, header: c.header })) }],
      });
    }

    const where = await whereCoupures(req);
    const brutes = await prisma.coupureReseau.findMany({
      where,
      // Même ordre que l'écran : composite pour les en-cours, sinon chronologie inverse.
      orderBy: req.query.statut === 'EN_COURS'
        ? [{ technologie: 'desc' as const }, { dateDebut: 'asc' as const }]
        : { dateDebut: 'desc' as const },
      take: EXPORT_MAX,
      include: {
        site: { select: { nom: true, region: true } },
        incident: { select: { reference: true } },
        coupureOrigine: { select: { site: { select: { nom: true } } } },
      },
    });
    // Comme à l'écran : chaque héritée est regroupée DIRECTEMENT sous sa
    // racine (si elle est dans l'export) - la hiérarchie de la panne se lit
    // de haut en bas. Une héritée dont la racine est hors filtre reste à sa
    // place chronologique.
    const heriteesParRacine = new Map<string, typeof brutes>();
    const tetes: typeof brutes = [];
    for (const c of brutes) {
      if (c.origine === 'HERITEE' && c.coupureOrigineId && brutes.some((r) => r.id === c.coupureOrigineId)) {
        const l = heriteesParRacine.get(c.coupureOrigineId) ?? [];
        l.push(c); heriteesParRacine.set(c.coupureOrigineId, l);
      } else tetes.push(c);
    }
    const rows = tetes.flatMap((c) => [c, ...(heriteesParRacine.get(c.id) ?? [])]);

    const { date_debut, date_fin } = req.query as Record<string, string>;
    const periodeTexte = date_debut || date_fin
      ? `Période : ${date_debut || '…'} → ${date_fin || '…'}`
      : 'Toutes périodes';

    // Format xlsx → classeur designé (Synthèse + Détail) ; PDF → tableau simple.
    if (req.params.format === 'xlsx') {
      const restreint = isRestreint(await sitePerimetre(req.user!.id));
      const colonnesQ = typeof req.query.colonnes === 'string' && req.query.colonnes
        ? new Set(req.query.colonnes.split(',').map((x) => x.trim()).filter(Boolean))
        : null;
      const wb = construireClasseurCoupures({
        lignes: rows.map((c) => ({
          siteNom: c.site.nom,
          region: c.site.region,
          technologie: c.technologie,
          dateDebut: c.dateDebut,
          dateFin: c.dateFin,
          downtimeMinutes: c.downtimeMinutes,
          typeAlarme: c.typeAlarme,
          causeCategorie: c.causeCategorie,
          origine: c.origine,
          origineSiteNom: c.coupureOrigine?.site?.nom ?? null,
          source: c.source,
          priseEnChargePar: c.priseEnChargePar ?? null,
          incidentRef: c.incident?.reference ?? null,
          cause: c.cause,
          actions: c.actions,
          intervenants: c.intervenants,
        })),
        periodeTexte,
        perimetreTexte: restreint ? 'vos lots' : 'réseau entier',
        colonnes: colonnesQ && colonnesQ.size ? colonnesQ : null,
      });
      await auditLog(req.user!.id, 'EXPORT', 'coupure_reseau', undefined, { count: rows.length, format: 'xlsx' }, req);
      setXlsxHeaders(res, 'coupures-reseau.xlsx');
      await wb.xlsx.write(res);
      return res.end();
    }

    const fmtDh = (d: Date | null) =>
      d ? d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lome' }) : '';

    await auditLog(req.user!.id, 'EXPORT', 'coupure_reseau', undefined, { count: rows.length, format: 'pdf' }, req);
    await sendTabular(res, req.params.format, 'coupures-reseau', 'Coupures réseau', [{
      name: 'Coupures',
      columns: [
        { header: 'Site', key: 'site', width: 24 },
        { header: 'Région', key: 'region', width: 16 },
        { header: 'Technologie', key: 'technologie', width: 12 },
        { header: 'Début', key: 'debut', width: 18 },
        { header: 'Fin', key: 'fin', width: 18 },
        { header: 'Downtime (min)', key: 'downtimeMin', width: 14 },
        { header: 'Alarme', key: 'alarme', width: 9 },
        { header: 'Catégorie', key: 'categorie', width: 10 },
        { header: 'Origine', key: 'origine', width: 20 },
        { header: 'Source', key: 'source', width: 22 },
        { header: 'Incident', key: 'incident', width: 16 },
        { header: 'Cause', key: 'cause', width: 34 },
        { header: 'Actions', key: 'actions', width: 34 },
        { header: 'Intervenant(s)', key: 'intervenants', width: 22 },
      ],
      rows: rows.map((c) => ({
        site: c.origine === 'HERITEE' ? `  ↳ ${c.site.nom}` : c.site.nom,
        region: c.site.region,
        technologie: c.technologie === 'SITE' ? 'Site entier' : c.technologie,
        debut: fmtDh(c.dateDebut),
        fin: c.dateFin ? fmtDh(c.dateFin) : 'EN COURS',
        downtimeMin: c.downtimeMinutes ?? '',
        alarme: c.typeAlarme ?? '',
        categorie: c.causeCategorie ?? '',
        // Héritée : le site AMONT responsable est nommé, comme dans le xlsx.
        origine: c.origine === 'HERITEE' ? `← ${c.coupureOrigine?.site?.nom ?? 'amont'}` : 'Locale',
        source: c.source === 'OSS'
          ? (c.priseEnChargePar ? `AUTO · ${c.priseEnChargePar}` : 'AUTO (non prise en charge)')
          : 'Manuelle',
        incident: c.incident?.reference ?? '',
        cause: c.cause ?? '',
        actions: c.actions ?? '',
        intervenants: c.intervenants ?? '',
      })),
    }], `${rows.length} coupure(s) · ${periodeTexte}`);
  } catch (err) { next(err); }
}
