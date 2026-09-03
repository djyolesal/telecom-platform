import { Request, Response, NextFunction } from 'express';
import { L_SEVERITE, L_STATUT_INCIDENT, libelle } from '../utils/libelles';
import { sitePerimetre, isRestreint, assertSiteInPerimetre, assertTechnicienAssignable, techniciensAssignables } from '../utils/perimetre';
import { resolvePrestataireId } from './maintenances.controller';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { idempotencyKey, memeAuteur } from '../utils/idempotency';
import { cloturerHeriteesRecursif } from './coupuresReseau.controller';
import { AppError } from '../utils/AppError';
import { pick } from '../utils/pick';
import { paginate } from '../utils/paginator';
import { triListe } from '../utils/triListe';
import { auditLog } from '../services/audit.service';
import { notificationService } from '../services/notifications.service';
import { sendTabular, EXPORT_MAX } from '../utils/exporter';
import { io } from '../server';
import { differenceInMinutes } from 'date-fns';
import { assertOnSite } from '../utils/geofence';
import { publicFileUrl } from '../services/storage.service';
import { notifierAction, envoyerSmsUtilisateur, rendreTemplate } from '../services/sms.service';
import { genererReference } from '../services/reference.service';

// Photos minimum (prises sur place) pour clôturer un incident.
const MIN_PHOTOS_INCIDENT = 6;

export async function getIncidents(req: Request, res: Response, next: NextFunction) {
  try {
    const { type, severite, statut, site_id, technicien_id, region, search, page = '1', limit = '20' } = req.query as Record<string, string>;

    const where: Record<string, unknown> = {};
    if (search) where.OR = [
      { reference: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      { site: { is: { nom: { contains: search, mode: 'insensitive' } } } },
    ];
    if (type) where.type = type;
    if (severite) where.severite = severite;
    if (statut) where.statut = statut;
    if (site_id) where.siteId = site_id;
    if (technicien_id) where.technicienId = technicien_id;
    // Périmètre prestataire : incidents des sites de ses lots uniquement.
    const perimetre = await sitePerimetre(req.user!.id);
    if (isRestreint(perimetre)) where.site = { ...(where.site as object ?? {}), ...perimetre };
    if (region) where.site = { ...(where.site as object ?? {}), region };

    // Tri d'en-tête délégué (liste blanche) ; défaut : incidents actifs
    // (OUVERT, EN_COURS) avant les résolus/clos, puis sévérité, puis récence.
    const triExplicite = triListe(req.query, {
      reference: (s) => ({ reference: s }),
      site: (s) => ({ site: { nom: s } }),
      type: (s) => ({ type: s }),
      severite: (s) => ({ severite: s }),
      statut: (s) => ({ statut: s }),
      technicien: (s) => ({ technicien: { nom: s } }),
      dateOuverture: (s) => ({ dateOuverture: s }),
    }, { dateOuverture: 'desc' });

    const { data, meta } = await paginate(
      prisma.incident,
      {
        where,
        // statut asc = ordre de l'enum (OUVERT < EN_COURS < RESOLU < CLOS) :
        // les incidents encore actifs remontent au-dessus des résolus.
        orderBy: triExplicite ?? [{ statut: 'asc' }, { severite: 'asc' }, { dateOuverture: 'desc' }],
        include: {
          site: { select: { nom: true, code: true, region: true } },
          technicien: { select: { nom: true, prenom: true } },
        },
      },
      { page: parseInt(page), limit: parseInt(limit) }
    );

    res.json({ success: true, data, meta });
  } catch (err) { next(err); }
}

export async function getIncidentById(req: Request, res: Response, next: NextFunction) {
  try {
    const incident = await prisma.incident.findUnique({
      where: { id: req.params.id },
      include: {
        site: true,
        technicien: { select: { id: true, nom: true, prenom: true, telephone: true } },
        declarant: { select: { id: true, nom: true, prenom: true } },
        maintenances: { select: { id: true, type: true, statut: true, datePlanifiee: true } },
      },
    });
    if (!incident) throw new AppError('Incident introuvable', 404);
    await assertSiteInPerimetre(req.user!.id, incident.siteId);

    // Photos terrain (table polymorphe) — URL recalculée depuis la clé MinIO.
    const photos = await prisma.photo.findMany({
      where: { entityType: 'incident', entityId: incident.id },
      orderBy: { createdAt: 'asc' },
    });
    res.json({
      success: true,
      data: {
        ...incident,
        photos: photos.map((p) => ({ ...p, url: p.minioKey ? publicFileUrl(p.minioKey) : p.url })),
        // Signatures visibles sur la fiche une fois l'incident résolu/clos
        // (même logique que le PDF de maintenance : un emplacement attendu
        // mais non signé sort avec url null → « Signature manquante »).
        signatures: ['RESOLU', 'CLOS'].includes(incident.statut) || incident.signaturePath
          ? [
              {
                label: 'Technicien',
                nom: incident.technicien ? `${incident.technicien.prenom} ${incident.technicien.nom}` : null,
                url: incident.signaturePath ? publicFileUrl(incident.signaturePath) : null,
              },
              ...(incident.nomAgentSecurite || incident.signatureAgentSecuritePath
                ? [{
                    label: 'Agent de sécurité',
                    nom: incident.nomAgentSecurite ?? null,
                    url: incident.signatureAgentSecuritePath ? publicFileUrl(incident.signatureAgentSecuritePath) : null,
                  }]
                : []),
            ]
          : [],
      },
    });
  } catch (err) { next(err); }
}

export async function createIncident(req: Request, res: Response, next: NextFunction) {
  try {
    const b = req.body as Record<string, unknown>;
    if (!b.siteId || !b.type || !b.severite || !b.description) {
      throw new AppError('Site, type, sévérité et description sont requis.', 400);
    }
    // Un compte prestataire ne déclare que sur SES sites (sinon : incident
    // fantôme chez un concurrent, avec notification à ses superviseurs).
    await assertSiteInPerimetre(req.user!.id, String(b.siteId));
    // Le type vient du RÉFÉRENTIEL éditable (ex-enum) : la validation que
    // Prisma faisait au niveau de l'enum se fait désormais ici.
    const typeRef = await prisma.typeIncidentRef.findUnique({ where: { code: String(b.type).toUpperCase() } });
    if (!typeRef || !typeRef.actif) throw new AppError('Type d\'incident inconnu ou désactivé.', 422);
    b.type = typeRef.code;
    // Liste blanche : statut/dates/technicien fixés par le workflow, declarePar
    // toujours l'utilisateur courant (jamais usurpé depuis le client).
    const data = pick<Prisma.IncidentUncheckedCreateInput>(b, [
      'siteId', 'type', 'severite', 'description', 'latitude', 'longitude',
    ]);
    // Idempotence (rejeu de la file offline) : la clé stable devient l'id —
    // sans elle, une réponse perdue produisait un SECOND incident, une seconde
    // notification CRITIQUE et un MTTR faussé.
    const clientUuid = idempotencyKey(req);
    if (clientUuid) {
      const deja = memeAuteur(await prisma.incident.findUnique({ where: { id: clientUuid } }), req.user!.id);
      if (deja) return res.status(200).json({ success: true, data: deja, idempotent: true });
    }

    const incident = await prisma.$transaction(async (tx) => tx.incident.create({
      data: {
        ...(clientUuid ? { id: clientUuid } : {}),
        ...(data as Prisma.IncidentUncheckedCreateInput),
        // Réf. dans la transaction du create → pas de trou si le create échoue.
        reference: await genererReference(tx, 'INC', new Date()),
        declarePar: req.user!.id,
      },
      include: { site: { select: { nom: true, code: true, region: true } } },
    }));

    await auditLog(req.user!.id, 'CREATE', 'incidents', incident.id, data, req);

    // Notifier via WebSocket
    io.of('/supervision').emit('incident:created', {
      id: incident.id,
      type: incident.type,
      severite: incident.severite,
      site: incident.site,
      dateOuverture: incident.dateOuverture,
    });

    // Push notifications si critique
    if (incident.severite === 'CRITIQUE' || incident.severite === 'MAJEUR') {
      await notificationService.sendToRole('SUPERVISEUR', {
        title: `🔴 Incident ${libelle(L_SEVERITE, incident.severite)} - ${incident.site.nom}`,
        body: incident.description.substring(0, 100),
        data: { incidentId: incident.id, type: 'incident' },
      });
    }

    res.status(201).json({ success: true, data: incident });
  } catch (err) { next(err); }
}

export async function updateIncident(req: Request, res: Response, next: NextFunction) {
  try {
    const incident = await prisma.incident.findUnique({ where: { id: req.params.id } });
    if (!incident) throw new AppError('Incident introuvable', 404);
    await assertSiteInPerimetre(req.user!.id, incident.siteId);

    // Liste blanche : le workflow (statut, dates, technicien) passe par assign/
    // demarrer/close. Ce PUT ne modifie que la description du problème.
    const data = pick<Prisma.IncidentUncheckedUpdateInput>(req.body, [
      'type', 'severite', 'description', 'causeProbable', 'actionCorrective',
    ]);
    if (Object.keys(data).length === 0) throw new AppError('Aucun champ modifiable fourni.', 400);

    const updated = await prisma.incident.update({ where: { id: req.params.id }, data });
    await auditLog(req.user!.id, 'UPDATE', 'incidents', incident.id, { after: data }, req);

    io.of('/supervision').emit('incident:updated', { id: updated.id, statut: updated.statut });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

/**
 * Techniciens ASSIGNABLES à un incident : ceux dont le périmètre couvre le
 * site — les internes, plus les techniciens des prestataires titulaires du
 * lot (annotés société + scope contractuel pour guider le choix). Un
 * superviseur prestataire ne voit que les siens. La liste évite au web de
 * proposer des comptes que le serveur refuserait de toute façon.
 */
export async function getTechniciensAssignables(req: Request, res: Response, next: NextFunction) {
  try {
    const incident = await prisma.incident.findUnique({ where: { id: req.params.id }, select: { siteId: true } });
    if (!incident) throw new AppError('Incident introuvable', 404);
    await assertSiteInPerimetre(req.user!.id, incident.siteId);

    res.json({ success: true, data: await techniciensAssignables(req.user!.id, incident.siteId) });
  } catch (err) { next(err); }
}

export async function assignIncident(req: Request, res: Response, next: NextFunction) {
  try {
    const { technicienId } = req.body;
    if (!technicienId || typeof technicienId !== 'string') throw new AppError('Technicien requis', 400);

    // Cloisonnement : l'incident doit être dans le périmètre de l'appelant
    // (sans quoi un superviseur d'un autre prestataire pouvait s'attribuer, ou
    // attribuer à n'importe qui, l'incident d'un site tiers).
    const existant = await prisma.incident.findUnique({ where: { id: req.params.id }, select: { siteId: true } });
    if (!existant) throw new AppError('Incident introuvable', 404);
    await assertSiteInPerimetre(req.user!.id, existant.siteId);

    // Mêmes règles que la réaffectation de maintenance : technicien actif,
    // couvrant le site, et — pour un superviseur de société — uniquement les
    // techniciens de SA société. La liste proposée au web était déjà filtrée
    // ainsi ; le serveur, lui, laissait passer une assignation inter-sociétés
    // forgée à la main (site couvert par deux prestataires : passif + solaire).
    await assertTechnicienAssignable(req.user!.id, technicienId, existant.siteId);

    const incident = await prisma.incident.update({
      where: { id: req.params.id },
      data: { technicienId, statut: 'EN_COURS' },
      include: { site: { select: { nom: true, code: true } } },
    });

    await auditLog(req.user!.id, 'ASSIGN', 'incidents', incident.id, { technicienId }, req);

    // Notifier le technicien : in-app + push, ET SMS sur son numéro (gabarit
    // éditable, interrupteur sms.affectations, plafond/GSM-7/journal hérités).
    await notificationService.sendToUser(technicienId, {
      title: `📋 Incident assigné - ${incident.site.nom}`,
      body: `Vous êtes assigné à l'incident : ${incident.description.substring(0, 80)}`,
      data: { incidentId: incident.id, type: 'incident_assigned' },
    });
    void envoyerSmsUtilisateur(
      technicienId,
      rendreTemplate('sms.tpl.affectationIncident', {
        site: incident.site.nom,
        reference: incident.reference ?? incident.id.slice(0, 8),
        severite: libelle(L_SEVERITE, incident.severite),
      }),
      'INCIDENT_AFFECTATION'
    );

    res.json({ success: true, data: incident });
  } catch (err) { next(err); }
}

/**
 * Démarre l'intervention sur un incident : le technicien doit être SUR le site
 * (vérification GPS). Passe l'incident EN_COURS et fige la date d'intervention.
 */
export async function startIncident(req: Request, res: Response, next: NextFunction) {
  try {
    const { latitude, longitude } = req.body;
    const incident = await prisma.incident.findUnique({
      where: { id: req.params.id },
      include: { site: { select: { latitude: true, longitude: true, code: true, nom: true } } },
    });
    if (!incident) throw new AppError('Incident introuvable', 404);
    await assertSiteInPerimetre(req.user!.id, incident.siteId);
    if (incident.statut === 'RESOLU' || incident.statut === 'CLOS') {
      throw new AppError(`Cet incident est déjà ${incident.statut === 'RESOLU' ? 'résolu' : 'clos'}.`, 409);
    }
    if (incident.dateIntervention) {
      throw new AppError("L'intervention sur cet incident est déjà démarrée.", 409);
    }

    // Tout incident doit être DÉMARRÉ sur le site.
    assertOnSite(incident.site, latitude, longitude, 'le démarrage');

    const updated = await prisma.incident.update({
      where: { id: req.params.id },
      data: {
        statut: 'EN_COURS',
        dateIntervention: new Date(),
        technicienId: incident.technicienId ?? req.user!.id,
      },
    });

    await auditLog(req.user!.id, 'UPDATE', 'incidents', incident.id, { action: 'demarrage', latitude, longitude }, req);
    io.of('/supervision').emit('incident:updated', { id: updated.id, statut: updated.statut });
    void notifierAction({
      domaine: 'INCIDENT', evenement: 'DEMARRAGE', siteNom: incident.site.nom ?? incident.site.code,
      technicienId: incident.technicienId ?? req.user!.id,
      detail: incident.reference ? `(${incident.reference})` : undefined,
    });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

export async function closeIncident(req: Request, res: Response, next: NextFunction) {
  try {
    const { dateIntervention, dateResolution, causeProbable, actionCorrective, causeCategorie, creerMaintenance, latitude, longitude, photos, agentPresent, nomAgentSecurite, signatureAgentSecuritePath, signaturePath } = req.body as {
      dateIntervention?: string;
      agentPresent?: boolean;
      nomAgentSecurite?: string;
      signatureAgentSecuritePath?: string;
      /** Signature du technicien qui clôture (obligatoire, comme la maintenance). */
      signaturePath?: string;
      dateResolution?: string;
      causeProbable?: string;
      actionCorrective?: string;
      /** Classement de l'indisponibilité constaté par le technicien : ACTIF | PASSIF. */
      causeCategorie?: string;
      creerMaintenance?: boolean;
      latitude?: number;
      longitude?: number;
      photos?: { url: string; key: string }[];
    };
    const incident = await prisma.incident.findUnique({
      where: { id: req.params.id },
      include: { site: { select: { latitude: true, longitude: true, code: true, nom: true } } },
    });
    if (!incident) throw new AppError('Incident introuvable', 404);
    await assertSiteInPerimetre(req.user!.id, incident.siteId);

    // Anti re-clôture : seul un incident EN COURS (intervention démarrée) se clôture.
    if (incident.statut !== 'EN_COURS' || !incident.dateIntervention) {
      throw new AppError(
        incident.statut === 'RESOLU' || incident.statut === 'CLOS'
          ? 'Cet incident est déjà clôturé.'
          : "L'intervention doit être démarrée (sur site) avant la clôture.",
        409
      );
    }

    // Tout incident doit être CLÔTURÉ sur le site.
    assertOnSite(incident.site, latitude, longitude, 'la clôture');

    // Signature du TECHNICIEN obligatoire pour clôturer (comme la maintenance
    // et le dépotage) — sauf incident déjà signé lors d'un rejeu offline.
    if (!signaturePath && !incident.signaturePath) {
      throw new AppError('La signature du technicien est requise pour clôturer.', 422);
    }
    // Agent de gardiennage PRÉSENT ⇒ il signe (même règle que le dépotage et
    // la clôture de maintenance) : la déclaration devient une preuve.
    if (agentPresent === true && !signatureAgentSecuritePath) {
      throw new AppError("L'agent est déclaré présent : sa signature est requise.", 422);
    }

    // Preuve terrain : minimum de photos prises sur place.
    const dejaPresentes = await prisma.photo.count({
      where: { entityType: 'incident', entityId: incident.id },
    });
    const totalPhotos = dejaPresentes + (photos?.length ?? 0);
    if (totalPhotos < MIN_PHOTOS_INCIDENT) {
      throw new AppError(
        `Au moins ${MIN_PHOTOS_INCIDENT} photos sont requises pour clôturer un incident (${totalPhotos} fournie(s)).`,
        422
      );
    }
    if (photos?.length) {
      await prisma.photo.createMany({
        data: photos
          .filter((p) => p && p.url && p.key)
          .map((p) => ({ entityType: 'incident', entityId: incident.id, url: p.url, minioKey: p.key })),
      });
    }

    // Date d'intervention figée au démarrage ; le corps reste accepté en repli.
    const dateInterv = incident.dateIntervention ?? new Date(dateIntervention ?? Date.now());
    // La date de résolution vient du mobile (rejeu offline) : bornée à
    // [dateIntervention, maintenant] — sinon `dateResolution = dateOuverture`
    // donnait 0 min de délai (SLA falsifiable) et une date future gonflait le MTTR.
    const maintenantRes = new Date();
    const brutRes = dateResolution ? new Date(dateResolution) : maintenantRes;
    const dateResol = !Number.isFinite(brutRes.getTime()) || brutRes > maintenantRes
      ? maintenantRes
      : brutRes < dateInterv ? dateInterv : brutRes;
    const delai = differenceInMinutes(dateInterv, incident.dateOuverture);
    const duree = differenceInMinutes(dateResol, incident.dateOuverture);

    const updated = await prisma.incident.update({
      where: { id: req.params.id },
      data: {
        statut: 'RESOLU',
        dateIntervention: dateInterv,
        dateResolution: dateResol,
        delaiInterventionMinutes: delai > 0 ? delai : 0,
        dureeCoupureMinutes: duree > 0 ? duree : 0,
        causeProbable,
        actionCorrective,
        ...(signaturePath ? { signaturePath: String(signaturePath) } : {}),
        ...(typeof agentPresent === 'boolean' ? { agentPresent } : {}),
        ...(nomAgentSecurite ? { nomAgentSecurite: String(nomAgentSecurite).slice(0, 100) } : {}),
        ...(signatureAgentSecuritePath ? { signatureAgentSecuritePath: String(signatureAgentSecuritePath) } : {}),
      },
    });

    // Créer maintenance curative si demandé
    if (creerMaintenance) {
      // Prestataire : ce chemin le laissait VIDE (fiche « Prestataire — »),
      // alors que la création manuelle le résout toujours. La vérité terrain
      // d'abord : la société du technicien qui a résolu ; à défaut (interne
      // sans société, incident non assigné), le titulaire du lot comme pour
      // une création manuelle en catégorie AUTRE (périmètre passif).
      let prestataireCuratif: string | null = null;
      if (incident.technicienId) {
        const tech = await prisma.user.findUnique({ where: { id: incident.technicienId }, select: { prestataireId: true } });
        prestataireCuratif = tech?.prestataireId ?? null;
      }
      if (!prestataireCuratif) prestataireCuratif = await resolvePrestataireId(incident.siteId, 'AUTRE');
      await prisma.$transaction(async (tx) => tx.maintenance.create({
        data: {
          reference: await genererReference(tx, 'MNT', dateResol),
          siteId: incident.siteId,
          incidentId: incident.id,
          type: 'CURATIVE',
          categorie: 'AUTRE',
          prestataireId: prestataireCuratif,
          equipement: 'À préciser',
          description: `Maintenance suite incident : ${incident.description}`,
          statut: 'TERMINEE',
          datePlanifiee: dateResol,
          dateDebut: dateInterv,
          dateFin: dateResol,
          // Durée réelle de l'intervention : sans elle la fiche affichait
          // « Durée — » malgré un début et une fin renseignés.
          dureeMinutes: Math.max(0, differenceInMinutes(dateResol, dateInterv)),
          technicienId: incident.technicienId,
        },
      }));
    }

    // La résolution terrain CLÔT automatiquement les coupures réseau liées
    // (et leur cascade héritée en aval) — le NOC garde la main pour rouvrir.
    const coupureLiees = await prisma.coupureReseau.findMany({
      where: { incidentId: incident.id, dateFin: null },
      select: { id: true, dateDebut: true },
    });
    let coupuresCloturees = 0;
    if (coupureLiees.length) {
      const minutes = (d: Date) => Math.max(0, Math.round((dateResol.getTime() - d.getTime()) / 60_000));
      const cc = causeCategorie && ['ACTIF', 'PASSIF'].includes(causeCategorie.toUpperCase())
        ? causeCategorie.toUpperCase() : undefined;
      await prisma.$transaction(coupureLiees.map((c) =>
        prisma.coupureReseau.update({
          where: { id: c.id },
          data: {
            dateFin: dateResol,
            downtimeMinutes: minutes(c.dateDebut),
            ...(causeProbable ? { cause: causeProbable.slice(0, 300) } : {}),
            ...(actionCorrective ? { actions: actionCorrective.slice(0, 300) } : {}),
            ...(cc ? { causeCategorie: cc } : {}),
          },
        })
      ));
      // Cascade RÉCURSIVE : les chaînes A→B→C laissaient les héritées de second
      // rang ouvertes à vie (downtime qui dérive indéfiniment).
      const heritees = await prisma.$transaction((tx) =>
        cloturerHeriteesRecursif(tx, coupureLiees.map((c) => c.id), dateResol, actionCorrective ?? null)
      );
      coupuresCloturees = coupureLiees.length + heritees;
    }

    await auditLog(req.user!.id, 'CLOSE', 'incidents', incident.id, { causeProbable, duree, coupuresCloturees }, req);
    io.of('/supervision').emit('incident:resolved', { id: updated.id, dureeCoupureMinutes: duree });
    void notifierAction({
      domaine: 'INCIDENT', evenement: 'CLOTURE', siteNom: incident.site.nom ?? incident.site.code,
      technicienId: incident.technicienId ?? req.user!.id,
      detail: incident.reference ? `(${incident.reference})` : undefined,
    });

    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

export async function deleteIncident(req: Request, res: Response, next: NextFunction) {
  try {
    const incident = await prisma.incident.findUnique({ where: { id: req.params.id } });
    if (!incident) throw new AppError('Incident introuvable', 404);
    await assertSiteInPerimetre(req.user!.id, incident.siteId);
    // Détacher les maintenances liées avant suppression
    await prisma.maintenance.updateMany({ where: { incidentId: incident.id }, data: { incidentId: null } });
    await prisma.incident.delete({ where: { id: req.params.id } });
    await auditLog(req.user!.id, 'DELETE', 'incidents', incident.id, {}, req);
    res.json({ success: true, message: 'Incident supprimé' });
  } catch (err) { next(err); }
}

export async function exportIncidents(req: Request, res: Response, next: NextFunction) {
  try {
    const { type, severite, statut, site_id, region } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (type) where.type = type;
    if (severite) where.severite = severite;
    if (statut) where.statut = statut;
    if (site_id) where.siteId = site_id;
    if (region) where.site = { ...(where.site as object ?? {}), region };
    // Même périmètre que la liste : un prestataire n'exporte que les incidents
    // de ses lots - l'export contournait le filtre appliqué à l'écran.
    const perimetreExp = await sitePerimetre(req.user!.id);
    if (isRestreint(perimetreExp)) where.site = { ...(where.site as object ?? {}), ...perimetreExp };

    // Libellés du référentiel types d'incident : jamais COUPURE_TOTALE brut
    // dans un fichier qui circule ensuite par mail.
    const typesRef = new Map(
      (await prisma.typeIncidentRef.findMany({ select: { code: true, libelle: true } })).map((t) => [t.code, t.libelle]),
    );
    const rows = await prisma.incident.findMany({
      where,
      take: EXPORT_MAX,
      orderBy: { dateOuverture: 'desc' },
      include: { site: { select: { code: true, region: true } }, technicien: { select: { nom: true, prenom: true } } },
    });

    await auditLog(req.user!.id, 'EXPORT', 'incidents', undefined, { count: rows.length }, req);
    await sendTabular(res, req.params.format, 'incidents', 'Incidents', [{
      name: 'Incidents',
      columns: [
        { header: 'Site', key: 'site', width: 14 },
        { header: 'Région', key: 'region', width: 14 },
        { header: 'Type', key: 'type', width: 16 },
        { header: 'Sévérité', key: 'severite', width: 12 },
        { header: 'Statut', key: 'statut', width: 12 },
        { header: 'Ouverture', key: 'ouverture', width: 18 },
        { header: 'Résolution', key: 'resolution', width: 18 },
        { header: 'MTTI (min)', key: 'mtti', width: 12 },
        { header: 'Coupure (min)', key: 'coupure', width: 14 },
        { header: 'Technicien', key: 'technicien', width: 20 },
      ],
      rows: rows.map((i) => ({
        site: i.site?.code ?? '',
        region: i.site?.region ?? '',
        type: typesRef.get(i.type) ?? i.type,
        severite: libelle(L_SEVERITE, i.severite),
        statut: libelle(L_STATUT_INCIDENT, i.statut),
        ouverture: i.dateOuverture.toLocaleString('fr-FR'),
        resolution: i.dateResolution ? i.dateResolution.toLocaleString('fr-FR') : '',
        mtti: i.delaiInterventionMinutes ?? '',
        coupure: i.dureeCoupureMinutes ?? '',
        technicien: i.technicien ? `${i.technicien.prenom} ${i.technicien.nom}` : '',
      })),
    }]);
  } catch (err) { next(err); }
}

export async function getIncidentKPIs(req: Request, res: Response, next: NextFunction) {
  try {
    const { periode = '30', region } = req.query as Record<string, string>;
    // parseInt non validé → NaN → fenêtre invalide → 500 Prisma.
    const brut = parseInt(periode, 10);
    const days = Number.isFinite(brut) ? Math.max(1, Math.min(730, brut)) : 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Périmètre prestataire : les KPI (dont le top 10 des sites les plus
    // problématiques) exposaient tout le parc, concurrents compris.
    const perimetre = await sitePerimetre(req.user!.id);
    const siteFilter = (region || isRestreint(perimetre))
      ? { site: { ...(isRestreint(perimetre) ? perimetre : {}), ...(region ? { region } : {}) } }
      : {};

    // Incidents de la période
    const incidents = await prisma.incident.findMany({
      where: { dateOuverture: { gte: since }, ...siteFilter },
      include: { site: { select: { region: true, code: true, nom: true } } },
    });

    const resolus = incidents.filter(i => i.statut === 'RESOLU' || i.statut === 'CLOS');
    const avecDelai = resolus.filter(i => i.delaiInterventionMinutes !== null);
    const avecDuree = resolus.filter(i => i.dureeCoupureMinutes !== null);

    const mttr = avecDuree.length
      ? Math.round(avecDuree.reduce((s, i) => s + (i.dureeCoupureMinutes || 0), 0) / avecDuree.length)
      : 0;
    const mtti = avecDelai.length
      ? Math.round(avecDelai.reduce((s, i) => s + (i.delaiInterventionMinutes || 0), 0) / avecDelai.length)
      : 0;

    // Taux résolution J+1 (1440 min), J+3, J+7
    const j1 = resolus.filter(i => (i.dureeCoupureMinutes || 0) <= 1440).length;
    const j3 = resolus.filter(i => (i.dureeCoupureMinutes || 0) <= 4320).length;
    const j7 = resolus.filter(i => (i.dureeCoupureMinutes || 0) <= 10080).length;

    // Par type
    const parType: Record<string, number> = {};
    incidents.forEach(i => { parType[i.type] = (parType[i.type] || 0) + 1; });

    // Par sévérité
    const parSeverite: Record<string, number> = {};
    incidents.forEach(i => { parSeverite[i.severite] = (parSeverite[i.severite] || 0) + 1; });

    // Top 10 sites
    const parSite: Record<string, { count: number; code: string; nom: string }> = {};
    incidents.forEach(i => {
      if (!parSite[i.siteId]) parSite[i.siteId] = { count: 0, code: i.site.code, nom: i.site.nom };
      parSite[i.siteId].count++;
    });
    const top10 = Object.entries(parSite).sort((a, b) => b[1].count - a[1].count).slice(0, 10);

    res.json({
      success: true,
      data: {
        periode: { jours: days, debut: since, fin: new Date() },
        total: incidents.length,
        ouverts: incidents.filter(i => i.statut === 'OUVERT').length,
        enCours: incidents.filter(i => i.statut === 'EN_COURS').length,
        resolus: resolus.length,
        mttr_minutes: mttr,
        mtti_minutes: mtti,
        tauxResolutionJ1: incidents.length ? Math.round(j1 / incidents.length * 100) : 0,
        tauxResolutionJ3: incidents.length ? Math.round(j3 / incidents.length * 100) : 0,
        tauxResolutionJ7: incidents.length ? Math.round(j7 / incidents.length * 100) : 0,
        parType,
        parSeverite,
        top10Sites: top10.map(([id, { count, code, nom }]) => ({ siteId: id, code, nom, count })),
      },
    });
  } catch (err) { next(err); }
}
