import { Request, Response, NextFunction } from 'express';
import { ScopeMaintenance, SourceEnergie, Prisma } from '@prisma/client';
import { differenceInMinutes, startOfWeek, endOfWeek, parseISO } from 'date-fns';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';
import { pick } from '../utils/pick';
import { paginate } from '../utils/paginator';
import { auditLog } from '../services/audit.service';
import { generateMaintenancePdf } from '../services/pdf.service';
import { uploadBuffer, publicFileUrl } from '../services/storage.service';
import { sendTabular } from '../utils/exporter';
import { GE_PARAMS } from '../utils/calculator';
import { expectedGasoilGE, analyseGasoilCoherence } from '../utils/energy';
import { getNum } from '../services/settings.service';
import { assertOnSite } from '../utils/geofence';

const techInclude = { technicien: { select: { nom: true, prenom: true } } };

// Catégories d'équipement → nature de maintenance (passive = infra/énergie, active = télécom).
const PASSIVE_CATS = ['GE', 'BATTERIE', 'CLIMATISEUR', 'CABLE'];
const ACTIVE_CATS = ['ANTENNE', 'RESEAU'];
const TARIF_CEET_FCFA = 105; // FCFA / kWh (indicatif)
const MIN_PHOTOS_PREVENTIVE = 6; // photos minimum pour clôturer une maintenance préventive
// Configurables via variables d'environnement (cf. config/env.ts).
// Seuils éditables en base (SystemSettings) avec repli sur l'environnement.
const minDureeClotureMin = () => getNum('maintenance.minDureeClotureMin', env.MIN_DUREE_CLOTURE_MIN);
const seuilEcartGasoilPct = () => getNum('maintenance.seuilEcartGasoilPct', env.SEUIL_ECART_GASOIL_PCT);

// Tâches contractuelles où la clôture exige UNIQUEMENT les photos (≥6) — pas de
// relevé énergie : entretien pylône, contrôle de terre, désherbage, serrures,
// entretien climatiseur, extincteurs, dératisation.
const TACHES_SANS_RELEVE = new Set(['entretien_pylone', 'controle_terre', 'desherbage', 'serrures', 'clim', 'extincteurs', 'deratisation']);

/**
 * La clôture exige-t-elle les relevés énergie (selon la config du site) ?
 * - Tâche contractuelle préventive : oui, SAUF les tâches d'exclusion ci-dessus
 *   (où seules les photos comptent).
 * - Sinon (curatif / saisie manuelle sans clé) : oui pour toutes, SAUF le
 *   climatiseur.
 */
const requiresEnergieReleve = (m: { categorie: string; tachePreventiveKey: string | null; natureTravaux?: string | null }): boolean => {
  // Un travail de cycle de vie (pose/dépose/déplacement) n'exige pas de relevé énergie.
  if (m.natureTravaux && m.natureTravaux !== 'ENTRETIEN') return false;
  return m.tachePreventiveKey ? !TACHES_SANS_RELEVE.has(m.tachePreventiveKey) : m.categorie !== 'CLIMATISEUR';
};

/**
 * Applique le mouvement d'actif déclenché par la clôture d'un travail de cycle de vie,
 * DANS la transaction de clôture (atomique avec le passage à TERMINEE). Valide l'existence,
 * le type et l'état de l'actif avant de le déplacer ; lève une AppError sinon.
 * INSTALLATION/DEPLACEMENT → posé sur le site (destination, EN_SERVICE, GE re-numéroté) ;
 * DESINSTALLATION → détaché (au dépôt, EN_STOCK, numéro réinitialisé).
 */
async function applyMouvementActif(
  tx: Prisma.TransactionClient,
  m: { natureTravaux: string; actifType: string | null; actifId: string | null; siteId: string; siteSourceId: string | null }
) {
  if (m.natureTravaux === 'ENTRETIEN') return;
  if (!m.actifType || !m.actifId) throw new AppError('Actif manquant pour ce mouvement.', 422);
  const isGE = m.actifType === 'GE';

  // Charge l'actif et valide son type + son état réel (peut avoir changé depuis la planif.).
  const actif = isGE
    ? await tx.groupeElectrogene.findUnique({ where: { id: m.actifId } })
    : await tx.equipementActif.findUnique({ where: { id: m.actifId } });
  if (!actif) throw new AppError("L'actif ciblé est introuvable.", 404);
  if (!isGE && (actif as { categorie: string }).categorie !== m.actifType) {
    throw new AppError("Le type de l'actif ne correspond pas à l'intervention.", 422);
  }

  if (m.natureTravaux === 'DESINSTALLATION') {
    if (actif.siteId == null) throw new AppError('Cet actif est déjà au dépôt (rien à désinstaller).', 409);
    const data = { siteId: null, statutActif: 'EN_STOCK' as const, isActive: false };
    if (isGE) await tx.groupeElectrogene.update({ where: { id: m.actifId }, data: { ...data, numero: 0 } });
    else await tx.equipementActif.update({ where: { id: m.actifId }, data });
    return;
  }
  if (m.natureTravaux === 'INSTALLATION' && actif.siteId != null) {
    throw new AppError('Cet actif est déjà installé (utilisez un déplacement).', 409);
  }
  if (m.natureTravaux === 'DEPLACEMENT') {
    if (m.siteSourceId === m.siteId) throw new AppError("Le site d'origine et de destination sont identiques.", 422);
    if (actif.siteId == null) throw new AppError('Cet actif est au dépôt (utilisez une installation).', 409);
  }

  // INSTALLATION ou DEPLACEMENT → poser sur le site de destination (= siteId).
  if (isGE) {
    const agg = await tx.groupeElectrogene.aggregate({ where: { siteId: m.siteId }, _max: { numero: true } });
    const numero = (agg._max.numero ?? 0) + 1; // collision éventuelle → retry P2002 au niveau transaction
    await tx.groupeElectrogene.update({ where: { id: m.actifId }, data: { siteId: m.siteId, numero, statutActif: 'EN_SERVICE', isActive: true } });
  } else {
    await tx.equipementActif.update({ where: { id: m.actifId }, data: { siteId: m.siteId, statutActif: 'EN_SERVICE', isActive: true } });
  }
}

/** Sources d'énergie présentes selon la configuration du site. */
function sourcesForConfig(powerConfig: string): SourceEnergie[] {
  switch (powerConfig) {
    case 'CEET_GE':
    case 'HYBRIDE_CEET_GE':
      return ['CEET', 'GE'];
    case 'CEET_UNIQUEMENT':
      return ['CEET'];
    case 'GE_UNIQUEMENT':
      return ['GE'];
    case 'HYBRIDE_GE':
      return ['GE', 'SOLAIRE'];
    case 'SOLAIRE_UNIQUEMENT':
      return ['SOLAIRE'];
    default:
      return [];
  }
}

/**
 * Détermine le prestataire responsable d'une maintenance à partir du lot du site
 * et du périmètre (passive/active déduit de la catégorie). Renvoie null si non attribué.
 */
async function resolvePrestataireId(siteId: string, categorie: string): Promise<string | null> {
  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { lotId: true } });
  if (!site?.lotId) return null;

  const scope = PASSIVE_CATS.includes(categorie)
    ? 'PASSIVE'
    : ACTIVE_CATS.includes(categorie)
      ? 'ACTIVE'
      : null;
  // Périmètre spécifique d'abord, puis "les deux"
  const scopes: ScopeMaintenance[] = scope
    ? [scope as ScopeMaintenance, 'LES_DEUX']
    : ['LES_DEUX'];

  const assignment = await prisma.lotAssignment.findFirst({
    where: { lotId: site.lotId, scope: { in: scopes } },
    orderBy: { scope: 'asc' },
  });
  return assignment?.prestataireId ?? null;
}

/** Résout le prestataire d'un site pour un périmètre donné (+ LES_DEUX en repli). */
async function resolvePrestataireIdByScope(siteId: string, scope: 'PASSIVE' | 'ACTIVE'): Promise<string | null> {
  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { lotId: true } });
  if (!site?.lotId) return null;
  const assignment = await prisma.lotAssignment.findFirst({
    where: { lotId: site.lotId, scope: { in: [scope, 'LES_DEUX'] as ScopeMaintenance[] } },
    orderBy: { scope: 'asc' },
  });
  return assignment?.prestataireId ?? null;
}

export async function getMaintenances(req: Request, res: Response, next: NextFunction) {
  try {
    const { type, statut, site_id, technicien_id, prestataire_id, categorie, date_debut, date_fin, search, page = '1', limit = '20' } =
      req.query as Record<string, string>;

    const where: Record<string, unknown> = {};
    if (type) where.type = type;
    if (statut) where.statut = statut;
    if (categorie) where.categorie = categorie;
    if (site_id) where.siteId = site_id;
    if (technicien_id) where.technicienId = technicien_id;
    if (prestataire_id) where.prestataireId = prestataire_id;
    // Recherche texte : équipement, nom/code du site.
    if (search) where.OR = [
      { equipement: { contains: search, mode: 'insensitive' } },
      { site: { nom: { contains: search, mode: 'insensitive' } } },
      { site: { code: { contains: search, mode: 'insensitive' } } },
    ];

    // Un technicien voit les activités de SON entreprise (prestataire) dans SON
    // périmètre (équipe passive → catégories passives, active → actives), PLUS
    // celles qui lui sont assignées (ex. planifiées par lui sur un site sans lot,
    // sinon elles disparaîtraient de sa liste).
    if (req.user!.role === 'TECHNICIEN') {
      const me = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { prestataireId: true, equipe: true },
      });
      const scope: Record<string, unknown>[] = [{ technicienId: req.user!.id }];
      if (me?.prestataireId) {
        const entreprise: Record<string, unknown> = { prestataireId: me.prestataireId };
        if (me.equipe) {
          entreprise.categorie = { in: me.equipe === 'ACTIVE' ? ACTIVE_CATS : PASSIVE_CATS };
        }
        scope.push(entreprise);
      }
      where.AND = [...((where.AND as unknown[]) ?? []), { OR: scope }];
    }
    if (date_debut || date_fin) {
      where.datePlanifiee = {
        ...(date_debut ? { gte: parseISO(date_debut) } : {}),
        ...(date_fin ? { lte: parseISO(date_fin) } : {}),
      };
    }

    const { data, meta } = await paginate(
      prisma.maintenance,
      {
        where,
        orderBy: { datePlanifiee: 'desc' },
        include: {
          ...techInclude,
          site: { select: { nom: true, code: true, region: true } },
          prestataire: { select: { id: true, nom: true } },
          _count: { select: { photos: true } },
        },
      },
      { page: parseInt(page), limit: parseInt(limit) }
    );

    res.json({ success: true, data, meta });
  } catch (err) { next(err); }
}

export async function getMaintenanceById(req: Request, res: Response, next: NextFunction) {
  try {
    const maintenance = await prisma.maintenance.findUnique({
      where: { id: req.params.id },
      include: {
        site: { include: { groupes: { where: { isActive: true }, orderBy: { numero: 'asc' } } } },
        technicien: { select: { id: true, nom: true, prenom: true, telephone: true } },
        prestataire: { select: { id: true, nom: true, contactCommercial: true, contactTechnique: true } },
        pieces: true,
        photos: true,
        releves: { include: { groupe: { select: { numero: true } } }, orderBy: { source: 'asc' } },
        incident: { select: { id: true, type: true, severite: true } },
      },
    });
    if (!maintenance) throw new AppError('Maintenance introuvable', 404);
    // URL des photos recalculée depuis la clé MinIO (jamais figée en base) :
    // robuste si l'IP/domaine (APP_URL) change après l'upload.
    const data = {
      ...maintenance,
      // Indique au client si la clôture exige les relevés énergie (selon la tâche).
      requiresEnergieReleve: requiresEnergieReleve(maintenance),
      photos: maintenance.photos.map((p) => ({ ...p, url: p.minioKey ? publicFileUrl(p.minioKey) : p.url })),
    };
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function createMaintenance(req: Request, res: Response, next: NextFunction) {
  try {
    const { pieces, ...data } = req.body;
    // La date planifiée ne peut pas être dans le passé (tolérance 60s).
    const dp = new Date(data.datePlanifiee);
    if (Number.isNaN(dp.getTime())) throw new AppError('Date planifiée invalide.', 422);
    if (dp.getTime() < Date.now() - 60_000) {
      throw new AppError('La date planifiée doit être postérieure ou égale à maintenant.', 422);
    }
    // Travail de cycle de vie : actif cible requis, existant, du bon type et dans l'état attendu.
    const nature = data.natureTravaux ?? 'ENTRETIEN';
    if (nature !== 'ENTRETIEN') {
      if (!data.actifType || !data.actifId) throw new AppError('Ce travail doit cibler un actif (type + identifiant).', 422);
      if (nature === 'DEPLACEMENT') {
        if (!data.siteSourceId) throw new AppError("Un déplacement doit préciser le site d'origine.", 422);
        if (data.siteSourceId === data.siteId) throw new AppError("Le site d'origine et de destination sont identiques.", 422);
      }
      const isGE = data.actifType === 'GE';
      const actif = isGE
        ? await prisma.groupeElectrogene.findUnique({ where: { id: data.actifId } })
        : await prisma.equipementActif.findUnique({ where: { id: data.actifId } });
      if (!actif) throw new AppError("L'actif ciblé est introuvable.", 404);
      if (!isGE && (actif as { categorie: string }).categorie !== data.actifType) {
        throw new AppError("Le type de l'actif ne correspond pas à l'intervention.", 422);
      }
      if (nature === 'INSTALLATION' && actif.siteId != null) throw new AppError('Cet actif est déjà installé (utilisez un déplacement).', 409);
      if ((nature === 'DESINSTALLATION' || nature === 'DEPLACEMENT') && actif.siteId == null) {
        throw new AppError('Cet actif est au dépôt (utilisez une installation).', 409);
      }
      // Anti double-booking : pas de second mouvement ouvert sur le même actif.
      const open = await prisma.maintenance.findFirst({
        where: { actifId: data.actifId, natureTravaux: { not: 'ENTRETIEN' }, statut: { in: ['PLANIFIEE', 'EN_COURS'] } },
      });
      if (open) throw new AppError('Un mouvement est déjà planifié ou en cours pour cet actif.', 409);
    }
    // Détermine automatiquement le prestataire responsable (site → lot → attribution).
    // Une tâche contractuelle est toujours passive → on résout sur le périmètre passif,
    // quelle que soit la catégorie (ex. AUTRE pour pylône/terre/désherbage…).
    const prestataireId = data.tachePreventiveKey
      ? await resolvePrestataireIdByScope(data.siteId, 'PASSIVE')
      : await resolvePrestataireId(data.siteId, data.categorie);
    const maintenance = await prisma.maintenance.create({
      data: {
        ...data,
        datePlanifiee: new Date(data.datePlanifiee),
        technicienId: data.technicienId ?? req.user!.id,
        prestataireId,
        ...(pieces?.length ? { pieces: { create: pieces } } : {}),
      },
      include: { pieces: true, prestataire: { select: { id: true, nom: true } } },
    });
    await auditLog(req.user!.id, 'CREATE', 'maintenances', maintenance.id, data, req);
    res.status(201).json({ success: true, data: maintenance });
  } catch (err) { next(err); }
}

export async function updateMaintenance(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.maintenance.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Maintenance introuvable', 404);

    // Liste blanche : la clôture/démarrage/mouvement passent par leurs endpoints
    // dédiés (avec geofence, photos, transaction). Ce PUT ne modifie QUE les
    // méta de planification — jamais statut/dateDebut/dateFin/dureeMinutes/actif*.
    const data = pick<Prisma.MaintenanceUncheckedUpdateInput>(req.body, [
      'equipement', 'categorie', 'description', 'observations',
      'datePlanifiee', 'technicienId', 'prestataireId', 'tachePreventiveKey',
    ]);
    if (data.datePlanifiee) data.datePlanifiee = new Date(data.datePlanifiee as string);
    if (Object.keys(data).length === 0) throw new AppError('Aucun champ modifiable fourni.', 400);

    const updated = await prisma.maintenance.update({ where: { id: req.params.id }, data });
    await auditLog(req.user!.id, 'UPDATE', 'maintenances', existing.id, data, req);
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

export async function deleteMaintenance(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.maintenance.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Maintenance introuvable', 404);
    // Seuls les plannings NON exécutés sont supprimables (préserve l'historique
    // : une maintenance démarrée ou clôturée porte relevés, photos, signatures).
    if (existing.statut !== 'PLANIFIEE') {
      throw new AppError('Seule une maintenance encore planifiée (non démarrée) peut être supprimée.', 409);
    }
    await prisma.maintenance.delete({ where: { id: req.params.id } });
    await auditLog(req.user!.id, 'DELETE', 'maintenances', existing.id, {}, req);
    res.json({ success: true, message: 'Maintenance planifiée supprimée' });
  } catch (err) { next(err); }
}

/** Démarre une maintenance (passage EN_COURS + horodatage). */
export async function startMaintenance(req: Request, res: Response, next: NextFunction) {
  try {
    const { latitude, longitude } = req.body;
    const existing = await prisma.maintenance.findUnique({
      where: { id: req.params.id },
      include: { site: { select: { latitude: true, longitude: true, code: true } } },
    });
    if (!existing) throw new AppError('Maintenance introuvable', 404);
    if (existing.statut === 'TERMINEE') throw new AppError('Maintenance déjà terminée', 409);

    // Une personne ne peut avoir qu'UNE seule maintenance en cours.
    const technicienId = existing.technicienId ?? req.user!.id;
    const dejaEnCours = await prisma.maintenance.findFirst({
      where: { statut: 'EN_COURS', technicienId, id: { not: existing.id } },
      select: { id: true },
    });
    if (dejaEnCours) {
      throw new AppError('Vous avez déjà une maintenance en cours. Clôturez-la avant d\'en démarrer une autre.', 409);
    }

    // Tout ticket doit être DÉMARRÉ sur le site. Pour un DÉPLACEMENT, la dépose se
    // fait sur le site SOURCE → on vérifie la présence là-bas (la pose/clôture, elle,
    // est vérifiée sur la destination).
    let startSite = existing.site;
    if (existing.natureTravaux === 'DEPLACEMENT' && existing.siteSourceId) {
      startSite = await prisma.site.findUnique({
        where: { id: existing.siteSourceId },
        select: { latitude: true, longitude: true, code: true },
      }) ?? existing.site;
    }
    assertOnSite(startSite, latitude, longitude, 'le démarrage');

    const updated = await prisma.maintenance.update({
      where: { id: req.params.id },
      data: {
        statut: 'EN_COURS',
        dateDebut: new Date(),
        technicienId: existing.technicienId ?? req.user!.id,
        latitudeDebut: latitude ?? undefined,
        longitudeDebut: longitude ?? undefined,
      },
    });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

/** Clôture une maintenance : durée calculée, pièces ajoutées, relevés énergie (passive), photos (préventive), PDF. */
export async function closeMaintenance(req: Request, res: Response, next: NextFunction) {
  try {
    const { observations, pieces, signaturePath, energie, photos, latitude, longitude } = req.body as {
      observations?: string;
      pieces?: Record<string, unknown>[];
      signaturePath?: string;
      energie?: Record<string, unknown>;
      photos?: { url: string; key: string }[];
      latitude?: number;
      longitude?: number;
    };
    const existing = await prisma.maintenance.findUnique({
      where: { id: req.params.id },
      include: {
        site: {
          select: {
            id: true, powerConfig: true, latitude: true, longitude: true, code: true,
            puissanceGEkva: true, statutGE: true,
            groupes: { where: { isActive: true }, orderBy: { numero: 'asc' } },
          },
        },
      },
    });
    if (!existing) throw new AppError('Maintenance introuvable', 404);

    // Rejeu idempotent : une maintenance DÉJÀ clôturée (retry réseau / re-sync)
    // renvoie un succès sans rien réappliquer — le mobile considère l'op terminée.
    if (existing.statut === 'TERMINEE') {
      return res.json({ success: true, data: existing, idempotent: true });
    }
    // Seule une maintenance EN COURS peut être clôturée.
    if (existing.statut !== 'EN_COURS') {
      throw new AppError(`Cette maintenance ne peut pas être clôturée (statut : ${existing.statut}).`, 409);
    }

    // Une maintenance doit avoir été démarrée et durer au moins 1h avant clôture.
    if (!existing.dateDebut) throw new AppError('La maintenance doit être démarrée avant clôture.', 409);
    const ecouleMin = differenceInMinutes(new Date(), existing.dateDebut);
    if (ecouleMin < minDureeClotureMin()) {
      throw new AppError(
        `Une maintenance doit durer au moins 1h avant clôture (démarrée il y a ${ecouleMin} min).`,
        422
      );
    }

    // Tout ticket doit être CLÔTURÉ sur le site.
    assertOnSite(existing.site, latitude, longitude, 'la clôture');

    // Maintenance préventive → minimum de photos requis pour clôturer.
    if (existing.type === 'PREVENTIVE') {
      const dejaPresentes = await prisma.photo.count({
        where: { entityType: 'maintenance', entityId: existing.id },
      });
      const totalPhotos = dejaPresentes + (photos?.length ?? 0);
      if (totalPhotos < MIN_PHOTOS_PREVENTIVE) {
        throw new AppError(
          `Au moins ${MIN_PHOTOS_PREVENTIVE} photos sont requises pour clôturer une maintenance préventive (${totalPhotos} fournie(s)).`,
          422
        );
      }
    }

    // Travail de cycle de vie (pose/dépose/déplacement) → preuve obligatoire : photos + signature.
    if (existing.natureTravaux !== 'ENTRETIEN') {
      const minPhotos = getNum('maintenance.minPhotosMouvement', 2);
      const dejaPresentes = await prisma.photo.count({ where: { entityType: 'maintenance', entityId: existing.id } });
      const totalPhotos = dejaPresentes + (photos?.length ?? 0);
      if (totalPhotos < minPhotos) {
        throw new AppError(`Au moins ${minPhotos} photos sont requises pour valider ce mouvement d'actif (${totalPhotos} fournie(s)).`, 422);
      }
      if (!signaturePath && !existing.signaturePath) {
        throw new AppError("La signature du technicien est requise pour valider ce mouvement d'actif.", 422);
      }
    }

    // Relevés énergie obligatoires selon la config du site, sauf tâches d'exclusion
    // (pylône, terre, désherbage, serrures, climatiseur, extincteurs → photos seules).
    const passive = requiresEnergieReleve(existing);
    const sources = passive ? sourcesForConfig(existing.site.powerConfig) : [];
    const e = energie ?? {};
    const num = (v: unknown): number | null => (v == null || v === '' ? null : Number(v));

    if (passive && sources.length) {
      const missing: string[] = [];
      if (sources.includes('GE')) {
        if (num(e.volumeGasoilLitres) == null) missing.push('volume gasoil dans la cuve');
        const geHours = (e.geHours ?? {}) as Record<string, unknown>;
        const groupes = existing.site.groupes ?? [];
        if (groupes.length) {
          for (const g of groupes) {
            if (num(geHours[g.id]) == null) missing.push(`index horaire GE n°${g.numero}`);
          }
        } else if (num(e.indexHeuresGE) == null) {
          missing.push('index horaire GE');
        }
      }
      if (sources.includes('CEET') && num(e.indexCompteur) == null) missing.push('index compteur CEET');
      if (sources.includes('SOLAIRE') && num(e.puissanceKva) == null) missing.push('puissance solaire');
      if (missing.length) {
        throw new AppError(
          `Paramètres énergie requis pour clôturer cette maintenance passive : ${missing.join(', ')}.`,
          422
        );
      }
    }

    const dateFin = new Date();
    const dateDebut = existing.dateDebut ?? dateFin;
    const dureeMinutes = Math.max(0, differenceInMinutes(dateFin, dateDebut));

    // Vidange GE confirmée (case cochée à la clôture) : l'index horaire saisi
    // devient la référence de l'actif, et la fiche/PDF le mentionne.
    const geHoursBody = (e.geHours ?? {}) as Record<string, unknown>;
    const vidangeIds = new Set((Array.isArray(e.vidangeGeIds) ? e.vidangeGeIds : []).map(String));
    const vidanges = (existing.site.groupes ?? [])
      .filter((g) => vidangeIds.has(g.id))
      .map((g) => ({ id: g.id, numero: g.numero, index: num(geHoursBody[g.id]) }))
      .filter((v) => v.index != null);
    const obsFinal = vidanges.length
      ? [
          `Vidange effectuée : ${vidanges.map((v) => `GE n°${v.numero} (index ${v.index} h)`).join(', ')}.`,
          observations ?? '',
        ].filter(Boolean).join('\n')
      : observations;

    // Écritures ATOMIQUES : pièces, photos, passage TERMINEE, relevés énergie ET
    // mouvement d'actif dans une seule transaction → tout réussit ou tout est annulé
    // (plus de maintenance TERMINEE avec actif non déplacé). Retry sur collision de
    // numéro GE (P2002), car nextNumeroGE est un read-then-write.
    const runClose = () =>
      prisma.$transaction(async (tx) => {
        // VERROU anti-double-clôture concurrente : le passage EN_COURS→TERMINEE
        // est fait EN PREMIER et conditionné. Postgres verrouille la ligne ; une
        // 2e transaction concurrente attend le commit puis voit statut TERMINEE →
        // count 0 → on abandonne (rejeu idempotent), aucune écriture dupliquée.
        const verrou = await tx.maintenance.updateMany({
          where: { id: req.params.id, statut: 'EN_COURS' },
          data: { statut: 'TERMINEE', dateFin, dureeMinutes, observations: obsFinal, signaturePath },
        });
        if (verrou.count === 0) throw Object.assign(new Error('ALREADY_CLOSED'), { alreadyClosed: true });

        if (pieces?.length) {
          await tx.pieceRechange.createMany({
            data: pieces.map((p) => ({ ...p, maintenanceId: existing.id })) as unknown as Prisma.PieceRechangeCreateManyInput[],
          });
        }
        // Photos prises sur place (carte GE, compteur CEET, activités)
        if (photos?.length) {
          await tx.photo.createMany({
            data: photos
              .filter((p) => p && p.url && p.key)
              .map((p) => ({ entityType: 'maintenance', entityId: existing.id, url: p.url, minioKey: p.key })),
          });
        }

        let m = await tx.maintenance.findUniqueOrThrow({ where: { id: req.params.id } });

        // Relevés énergie (un par source), consommations calculées par différence.
        let analyseEnergie: string | null = null;
        if (passive && sources.length) {
          const techId = existing.technicienId ?? req.user!.id;
          for (const source of sources) {
            if (source === 'GE') {
              const tank = num(e.volumeGasoilLitres);
              const geHours = (e.geHours ?? {}) as Record<string, unknown>;
              const groupes = existing.site.groupes ?? [];
              let gasoilConso: number | null = null;
              let gasoilCost: number | null = null;
              const prevTank = await tx.releveEnergie.findFirst({
                where: { siteId: existing.siteId, source: 'GE', volumeGasoilLitres: { not: null }, maintenanceId: { not: existing.id } },
                orderBy: { dateReleve: 'desc' },
              });
              if (prevTank?.volumeGasoilLitres != null && tank != null) {
                const depots = await tx.depotage.aggregate({
                  where: { siteId: existing.siteId, dateDepotage: { gt: prevTank.dateReleve, lte: dateFin } },
                  _sum: { volumeLitres: true },
                });
                const ajout = Number(depots._sum.volumeLitres ?? 0);
                gasoilConso = Math.max(0, Number(prevTank.volumeGasoilLitres) + ajout - tank);
                gasoilCost = Math.round(gasoilConso * GE_PARAMS.prixLitreFCFA);
              }
              const cibles = groupes.length ? groupes : [null];
              let first = true;
              let expectedGasoil = 0;
              let hasHeures = false;
              for (const g of cibles) {
                const hIndex = g ? num(geHours[g.id]) : num(e.indexHeuresGE);
                const prevGe = await tx.releveEnergie.findFirst({
                  where: { siteId: existing.siteId, source: 'GE', maintenanceId: { not: existing.id }, ...(g ? { groupeId: g.id } : {}) },
                  orderBy: { dateReleve: 'desc' },
                });
                const data: Prisma.ReleveEnergieUncheckedCreateInput = {
                  siteId: existing.siteId, dateReleve: dateFin, source: 'GE',
                  technicienId: techId, maintenanceId: existing.id,
                  groupeId: g?.id, indexHeuresGE: hIndex,
                };
                if (prevGe?.indexHeuresGE != null && hIndex != null) {
                  const heures = Math.max(0, hIndex - Number(prevGe.indexHeuresGE));
                  data.heuresFonctGE = heures;
                  if (heures > 0) {
                    const kva = g ? Number(g.puissanceKva) : Number(existing.site.puissanceGEkva);
                    const statut = g ? g.statut : existing.site.statutGE;
                    expectedGasoil += expectedGasoilGE(kva, statut, heures);
                    hasHeures = true;
                  }
                }
                if (first) {
                  data.volumeGasoilLitres = tank;
                  data.gasoilConsommeLitres = gasoilConso;
                  data.coutEstime = gasoilCost;
                  first = false;
                }
                await tx.releveEnergie.create({ data });
              }
              analyseEnergie = analyseGasoilCoherence({ consomme: gasoilConso, attendu: expectedGasoil, hasHeures, seuilPct: seuilEcartGasoilPct() });
            } else if (source === 'CEET') {
              const index = num(e.indexCompteur);
              const prev = await tx.releveEnergie.findFirst({
                where: { siteId: existing.siteId, source: 'CEET', maintenanceId: { not: existing.id } },
                orderBy: { dateReleve: 'desc' },
              });
              const data: Prisma.ReleveEnergieUncheckedCreateInput = {
                siteId: existing.siteId, dateReleve: dateFin, source: 'CEET',
                technicienId: techId, maintenanceId: existing.id, indexCompteur: index,
              };
              if (prev?.indexCompteur != null && index != null) {
                const kwh = Math.max(0, index - Number(prev.indexCompteur));
                data.consommationKwh = kwh;
                data.coutEstime = Math.round(kwh * TARIF_CEET_FCFA);
              }
              await tx.releveEnergie.create({ data });
            } else if (source === 'SOLAIRE') {
              await tx.releveEnergie.create({
                data: {
                  siteId: existing.siteId, dateReleve: dateFin, source: 'SOLAIRE',
                  technicienId: techId, maintenanceId: existing.id, puissanceKva: num(e.puissanceKva),
                },
              });
            }
          }
        }
        if (analyseEnergie) {
          m = await tx.maintenance.update({ where: { id: req.params.id }, data: { analyseEnergie } });
        }

        // Vidange confirmée → l'index saisi devient la référence du GE (atomique
        // avec la clôture : pas de vidange enregistrée si la clôture échoue).
        for (const v of vidanges) {
          await tx.groupeElectrogene.update({
            where: { id: v.id },
            data: { indexHeuresDerniereVidange: v.index!, dateDerniereVidange: dateFin },
          });
        }

        // Mouvement d'actif (pose/dépose/déplacement), atomique avec le passage TERMINEE.
        await applyMouvementActif(tx, existing);
        return m;
      }, { timeout: 15000, maxWait: 5000 }); // marge pour les sites multi-GE / base lente (défaut 5s trop court)

    let updated;
    for (let attempt = 0; attempt < 4; attempt++) {
      try { updated = await runClose(); break; }
      catch (err) {
        // Course concurrente perdue : l'autre transaction a clôturé → rejeu idempotent.
        if ((err as { alreadyClosed?: boolean }).alreadyClosed) {
          const m = await prisma.maintenance.findUnique({ where: { id: req.params.id } });
          return res.json({ success: true, data: m, idempotent: true });
        }
        if ((err as { code?: string }).code === 'P2002' && attempt < 3) continue; // collision numéro GE → retry
        throw err;
      }
    }
    if (!updated) throw new AppError('Échec de la clôture (réessayez).', 500);

    // Rapport PDF : généré HORS transaction (I/O MinIO). Best-effort — la clôture est
    // déjà validée, un échec PDF ne doit pas l'annuler.
    try {
      const full = await prisma.maintenance.findUnique({
        where: { id: req.params.id },
        include: { site: true, technicien: { select: { nom: true, prenom: true } }, pieces: true },
      });
      if (full) {
        const pdf = await generateMaintenancePdf(full);
        const stored = await uploadBuffer(pdf, `maintenance-${full.id}.pdf`, 'application/pdf', 'rapports');
        updated = await prisma.maintenance.update({ where: { id: req.params.id }, data: { rapportPdfPath: stored.key } });
      }
    } catch { /* PDF non bloquant : la clôture reste valide */ }

    await auditLog(req.user!.id, 'CLOSE', 'maintenances', existing.id, { dureeMinutes }, req);
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

/** Retourne (ou génère à la volée) le PDF d'une maintenance. */
export async function getMaintenancePdf(req: Request, res: Response, next: NextFunction) {
  try {
    const maintenance = await prisma.maintenance.findUnique({
      where: { id: req.params.id },
      include: { site: true, technicien: { select: { nom: true, prenom: true } }, pieces: true },
    });
    if (!maintenance) throw new AppError('Maintenance introuvable', 404);

    const pdf = await generateMaintenancePdf(maintenance);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="maintenance-${maintenance.id.slice(0, 8)}.pdf"`);
    res.send(pdf);
  } catch (err) { next(err); }
}

/** Planning hebdomadaire des maintenances (calendrier). */
export async function getPlanning(req: Request, res: Response, next: NextFunction) {
  try {
    const { semaine, region } = req.query as Record<string, string>;
    const ref = semaine ? parseISO(semaine) : new Date();
    const debut = startOfWeek(ref, { weekStartsOn: 1 });
    const fin = endOfWeek(ref, { weekStartsOn: 1 });

    const maintenances = await prisma.maintenance.findMany({
      where: {
        datePlanifiee: { gte: debut, lte: fin },
        ...(region ? { site: { region } } : {}),
      },
      orderBy: { datePlanifiee: 'asc' },
      include: {
        site: { select: { nom: true, code: true, region: true } },
        technicien: { select: { nom: true, prenom: true } },
      },
    });

    res.json({ success: true, data: { debut, fin, maintenances } });
  } catch (err) { next(err); }
}

export async function exportMaintenances(req: Request, res: Response, next: NextFunction) {
  try {
    const { type, statut, site_id } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (type) where.type = type;
    if (statut) where.statut = statut;
    if (site_id) where.siteId = site_id;

    const rows = await prisma.maintenance.findMany({
      where,
      orderBy: { datePlanifiee: 'desc' },
      include: { site: { select: { code: true, nom: true } }, technicien: { select: { nom: true, prenom: true } } },
    });

    await auditLog(req.user!.id, 'EXPORT', 'maintenances', undefined, { count: rows.length }, req);
    await sendTabular(res, req.params.format, 'maintenances', 'Maintenances', [{
      name: 'Maintenances',
      columns: [
        { header: 'Site', key: 'site', width: 18 },
        { header: 'Type', key: 'type', width: 12 },
        { header: 'Catégorie', key: 'categorie', width: 14 },
        { header: 'Équipement', key: 'equipement', width: 22 },
        { header: 'Statut', key: 'statut', width: 12 },
        { header: 'Technicien', key: 'technicien', width: 20 },
        { header: 'Planifiée', key: 'datePlanifiee', width: 18 },
        { header: 'Durée (min)', key: 'duree', width: 12 },
      ],
      rows: rows.map((m) => ({
        site: m.site?.code ?? '',
        type: m.type,
        categorie: m.categorie,
        equipement: m.equipement,
        statut: m.statut,
        technicien: m.technicien ? `${m.technicien.prenom} ${m.technicien.nom}` : '',
        datePlanifiee: m.datePlanifiee.toLocaleString('fr-FR'),
        duree: m.dureeMinutes ?? '',
      })),
    }]);
  } catch (err) { next(err); }
}
