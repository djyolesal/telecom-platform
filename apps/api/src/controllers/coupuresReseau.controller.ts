import { Request, Response, NextFunction } from 'express';
import ExcelJS from 'exceljs';
import { Readable } from 'stream';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { paginate } from '../utils/paginator';
import { auditLog } from '../services/audit.service';
import { sitePerimetre, isRestreint, assertSiteInPerimetre } from '../utils/perimetre';
import { descendantsTransmission } from '../utils/transmission';
import { genererReference } from '../services/reference.service';
import { notifierIncidentCoupure } from '../services/sms.service';
import { notificationService } from '../services/notifications.service';
import { sendTabular, EXPORT_MAX } from '../utils/exporter';
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
          `[E&M OpS] NOC : coupure ${technos.join('/')} sur ${coupures[0].site.nom} (site alimenté) — à traiter côté actif (radio/transmission).`,
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
    const { incident, cree } = await prisma.$transaction(async (tx) => {
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
          description: `Site entier hors service (coupure ${technos.join('/')}) signalé par le NOC${coupures[0].typeAlarme ? ` — alarme ${coupures[0].typeAlarme}` : ''}.`,
          declarePar: userId,
        },
        select: { id: true, reference: true },
      });
      await tx.coupureReseau.updateMany({ where: { id: { in: coupures.map((c) => c.id) } }, data: { incidentId: nouveau.id } });
      return { incident: nouveau, cree: true };
    });

    if (cree) {
      crees++;
      io.of('/supervision').emit('incident:created', { id: incident.id, siteId });
      await notifierIncidentCoupure(
        siteId,
        `[E&M OpS] NOC : site ${coupures[0].site.nom} entièrement hors service. Incident ${incident.reference ?? ''} — intervention terrain requise.`,
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
            body: `Incident ${incident!.reference ?? ''} créé par le NOC — intervention terrain requise.`,
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
async function resoudreIncidentSiPlusDeCoupure(
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
  // Rétabli SANS passage sur site (aucune intervention enregistrée) : le dire
  // explicitement — sinon l'incident résolu ressemble, dans les stats et à la
  // relecture, à une intervention terrain qui n'a jamais eu lieu.
  const sansIntervention = inc.dateIntervention == null;
  await tx.incident.update({
    where: { id: incidentId },
    data: {
      statut: 'RESOLU',
      dateResolution: quand,
      dureeCoupureMinutes: minutesEntre(inc.dateOuverture, quand),
      ...(sansIntervention && !inc.actionCorrective
        ? { actionCorrective: 'Rétablissement constaté par le NOC — aucune intervention terrain.' }
        : {}),
    },
  });
  return true;
}

/** Filtres communs liste/export (période, statut, techno, alarme, recherche) + périmètre. */
async function whereCoupures(req: Request): Promise<Record<string, unknown>> {
  const { site_id, technologie, type_alarme, statut, date_debut, date_fin, search } =
    req.query as Record<string, string>;
  const where: Record<string, unknown> = {};
  if (site_id) where.siteId = site_id;
  if (technologie) where.technologie = technologie;
  if (type_alarme) where.typeAlarme = type_alarme;
  if (statut === 'EN_COURS') where.dateFin = null;
  if (statut === 'TERMINEE') where.dateFin = { not: null };
  if (date_debut || date_fin) {
    where.dateDebut = {
      ...(date_debut ? { gte: new Date(date_debut) } : {}),
      // Une date « au » sans heure (YYYY-MM-DD) couvre la journée ENTIÈRE.
      ...(date_fin ? { lte: new Date(date_fin.length === 10 ? `${date_fin}T23:59:59` : date_fin) } : {}),
    };
  }
  const perimetre = await sitePerimetre(req.user!.id);
  if (search || isRestreint(perimetre)) {
    where.site = {
      ...(isRestreint(perimetre) ? perimetre : {}),
      ...(search ? { nom: { contains: search, mode: 'insensitive' } } : {}),
    };
  }
  return where;
}

export async function getCoupures(req: Request, res: Response, next: NextFunction) {
  try {
    const { page = '1', limit = '20' } = req.query as Record<string, string>;
    const where = await whereCoupures(req);
    const { data, meta } = await paginate(
      prisma.coupureReseau,
      {
        where,
        orderBy: { dateDebut: 'desc' },
        include: {
          site: { select: { nom: true, region: true } },
          coupureOrigine: { select: { id: true, site: { select: { nom: true } } } },
          incident: { select: { id: true, reference: true, statut: true } },
          _count: { select: { heritees: true } },
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
        await prisma.coupureReseau.createMany({
          data: aval.map((s) => ({
            siteId: s.id,
            technologie: 'SITE',
            dateDebut,
            cause: champs.cause ?? `Coupure amont — propagation transmission`,
            typeAlarme: champs.typeAlarme,
            origine: 'HERITEE',
            coupureOrigineId: racineId,
          })),
          skipDuplicates: true,
        });
        sitesImpactes = aval.length;
      }
    }

    // Incident terrain automatique (groupé par site) + dispatch SMS prestataire,
    // uniquement pour une coupure encore EN COURS (pas la saisie d'historique).
    const incidentsCrees = await rattacherIncidentsCoupures(req.user!.id, [siteId]);

    await auditLog(req.user!.id, 'CREATE', 'coupure_reseau', rows[0].id, { siteId, technologies, sitesImpactes, incidentsCrees }, req);
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
    // Clôture (ou ré-ouverture) → downtime recalculé, jamais saisi à la main.
    if ('dateFin' in data) {
      const fin = data.dateFin as Date | null;
      if (fin && fin < existing.dateDebut) throw new AppError('La fin ne peut pas précéder le début', 400);
      data.downtimeMinutes = fin ? minutesEntre(existing.dateDebut, fin) : null;
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
          `[E&M OpS] NOC : coupure toujours constatée sur ${incident.site.nom} — incident ${incident.reference ?? ''} ROUVERT, merci de repasser.`,
          'INCIDENT_ROUVERT_NOC'
        );
      }
    }

    await auditLog(req.user!.id, 'UPDATE', 'coupure_reseau', existing.id, { cloture: 'dateFin' in data, hériteesCloturees, incidentRouvert, incidentResolu }, req);
    res.json({ success: true, data: { ...updated, hériteesCloturees, incidentRouvert, incidentResolu } });
  } catch (err) { next(err); }
}

export async function deleteCoupure(req: Request, res: Response, next: NextFunction) {
  try {
    const existante = await prisma.coupureReseau.findUnique({
      where: { id: req.params.id },
      select: { incidentId: true },
    });
    if (!existante) throw new AppError('Coupure introuvable', 404);
    // Supprimer la DERNIÈRE coupure ouverte d'un incident (saisie erronée du
    // NOC) doit reboucler l'incident, comme une clôture : sinon il reste
    // OUVERT sans plus aucune coupure — jamais résolvable, escaladé à vie.
    await prisma.$transaction(async (tx) => {
      await tx.coupureReseau.delete({ where: { id: req.params.id } });
      await resoudreIncidentSiPlusDeCoupure(tx, existante.incidentId, new Date());
    });
    await auditLog(req.user!.id, 'DELETE', 'coupure_reseau', req.params.id, {}, req);
    res.json({ success: true });
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
            erreurs.push({ feuille: nomFeuille, ligne: n, message: `rétablissement (${fin.toISOString().slice(0, 16)}) antérieur au début (${debut.toISOString().slice(0, 16)}) — ligne écartée` });
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
        if (resolu) incidentsResolus++;
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
    res.json({
      success: true,
      data: {
        lignes: lots.length,
        crees,
        doublonsIgnores: doublons,
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

export async function getDisponibiliteReseau(req: Request, res: Response, next: NextFunction) {
  try {
    const mois = req.query.mois ? Math.max(1, Math.min(24, parseInt(String(req.query.mois), 10))) : 3;
    const depuis = new Date(); depuis.setMonth(depuis.getMonth() - mois); depuis.setHours(0, 0, 0, 0);
    const maintenant = new Date();
    const fenetreMin = minutesEntre(depuis, maintenant);

    // Périmètre : un prestataire ne voit que la disponibilité de SES lots ;
    // les internes (NOC/direction) voient tout + la déclinaison par prestataire.
    const perimetre = await sitePerimetre(req.user!.id);
    const restreint = isRestreint(perimetre);
    const whereSite = { isActive: true, ...(restreint ? perimetre : {}) };

    const [coupures, nbSites, lots] = await Promise.all([
      prisma.coupureReseau.findMany({
        where: {
          OR: [{ dateFin: null }, { dateFin: { gte: depuis } }],
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
      // Downtime borné à la fenêtre d'analyse (une coupure ouverte court jusqu'à maintenant).
      const debut = c.dateDebut < depuis ? depuis : c.dateDebut;
      const fin = c.dateFin ?? maintenant;
      if (fin <= depuis) continue;
      const iv: Intervalle = { debut, fin };
      if (!c.dateFin) enCours++;
      pousser(ivSite, c.siteId, iv);
      if (c.typeAlarme && ENERGIE.has(c.typeAlarme)) pousser(ivEnergie, c.siteId, iv);
      if (c.causeCategorie === 'ACTIF') pousser(ivActif, c.siteId, iv);
      else if (c.causeCategorie === 'PASSIF') pousser(ivPassif, c.siteId, iv);

      const ps = parSite.get(c.siteId) ?? { nom: c.site.nom, region: c.site.region, downtime: 0, coupures: 0, enCours: 0 };
      ps.coupures += 1; if (!c.dateFin) ps.enCours += 1;
      parSite.set(c.siteId, ps);

      const ta = c.typeAlarme ?? '—';
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
    res.json({
      success: true,
      data: {
        periodeMois: mois,
        perimetreRestreint: restreint,
        kpis: {
          coupures: coupures.filter((c) => (c.dateFin ?? maintenant) > depuis).length,
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
        topSites: [...parSite.values()]
          .map((s) => ({ ...s, downtimeHeures: Math.round(s.downtime / 60), dispoPct: Math.max(0, Math.round((1 - s.downtime / fenetreMin) * 1000) / 10) }))
          .sort((a, b) => b.downtime - a.downtime)
          .slice(0, 15),
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
      },
    });
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
    const rows = await prisma.coupureReseau.findMany({
      where,
      orderBy: { dateDebut: 'desc' },
      take: EXPORT_MAX,
      include: {
        site: { select: { nom: true, region: true } },
        incident: { select: { reference: true } },
        coupureOrigine: { select: { site: { select: { nom: true } } } },
      },
    });

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
        { header: 'Origine', key: 'origine', width: 10 },
        { header: 'Incident', key: 'incident', width: 16 },
        { header: 'Cause', key: 'cause', width: 34 },
        { header: 'Actions', key: 'actions', width: 34 },
        { header: 'Intervenant(s)', key: 'intervenants', width: 22 },
      ],
      rows: rows.map((c) => ({
        site: c.site.nom,
        region: c.site.region,
        technologie: c.technologie === 'SITE' ? 'Site entier' : c.technologie,
        debut: fmtDh(c.dateDebut),
        fin: c.dateFin ? fmtDh(c.dateFin) : 'EN COURS',
        downtimeMin: c.downtimeMinutes ?? '',
        alarme: c.typeAlarme ?? '',
        categorie: c.causeCategorie ?? '',
        origine: c.origine === 'HERITEE' ? 'Héritée' : 'Locale',
        incident: c.incident?.reference ?? '',
        cause: c.cause ?? '',
        actions: c.actions ?? '',
        intervenants: c.intervenants ?? '',
      })),
    }], `${rows.length} coupure(s) · ${periodeTexte}`);
  } catch (err) { next(err); }
}
