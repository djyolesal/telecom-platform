import { Request, Response, NextFunction } from 'express';
import { ScopeMaintenance, SourceEnergie, Prisma } from '@prisma/client';
import { differenceInMinutes, startOfWeek, endOfWeek, parseISO } from 'date-fns';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';
import { paginate } from '../utils/paginator';
import { auditLog } from '../services/audit.service';
import { generateMaintenancePdf } from '../services/pdf.service';
import { uploadBuffer, publicFileUrl } from '../services/storage.service';
import { buildXlsx, setXlsxHeaders } from '../utils/excel';
import { GE_PARAMS } from '../utils/calculator';
import { expectedGasoilGE, analyseGasoilCoherence } from '../utils/energy';
import { getNum } from '../services/settings.service';

const techInclude = { technicien: { select: { nom: true, prenom: true } } };

// Catégories d'équipement → nature de maintenance (passive = infra/énergie, active = télécom).
const PASSIVE_CATS = ['GE', 'BATTERIE', 'CLIMATISEUR', 'CABLE'];
const ACTIVE_CATS = ['ANTENNE', 'RESEAU'];
const TARIF_CEET_FCFA = 105; // FCFA / kWh (indicatif)
const MIN_PHOTOS_PREVENTIVE = 6; // photos minimum pour clôturer une maintenance préventive
// Configurables via variables d'environnement (cf. config/env.ts).
// Seuils éditables en base (SystemSettings) avec repli sur l'environnement.
const minDureeClotureMin = () => getNum('maintenance.minDureeClotureMin', env.MIN_DUREE_CLOTURE_MIN);
const geofenceRadiusM = () => getNum('maintenance.geofenceRadiusM', env.GEOFENCE_RADIUS_M);
const seuilEcartGasoilPct = () => getNum('maintenance.seuilEcartGasoilPct', env.SEUIL_ECART_GASOIL_PCT);

const isPassiveCategorie = (cat: string) => PASSIVE_CATS.includes(cat);

// Tâches contractuelles où la clôture exige UNIQUEMENT les photos (≥6) — pas de
// relevé énergie : entretien pylône, contrôle de terre, désherbage, serrures,
// entretien climatiseur, extincteurs.
const TACHES_SANS_RELEVE = new Set(['entretien_pylone', 'controle_terre', 'desherbage', 'serrures', 'clim', 'extincteurs']);

/**
 * La clôture exige-t-elle les relevés énergie (selon la config du site) ?
 * Oui pour toute maintenance passive, SAUF les tâches d'exclusion ci-dessus
 * (où seules les photos comptent). Repli par catégorie pour les maintenances
 * sans clé contractuelle (curatif / saisie manuelle) → comportement historique.
 */
const requiresEnergieReleve = (m: { categorie: string; tachePreventiveKey: string | null }): boolean =>
  m.tachePreventiveKey ? !TACHES_SANS_RELEVE.has(m.tachePreventiveKey) : isPassiveCategorie(m.categorie);

/** Distance en mètres entre deux points GPS (formule de haversine). */
function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // rayon terrestre (m)
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Vérifie que l'opération (démarrage/clôture) est réalisée SUR le site.
 * - Si le site n'a pas de coordonnées, on ne peut pas vérifier → on laisse passer.
 * - Sinon la position GPS est obligatoire et doit être à moins de GEOFENCE_RADIUS_M.
 */
function assertOnSite(
  site: { latitude: Prisma.Decimal | null; longitude: Prisma.Decimal | null; code?: string },
  latitude: unknown,
  longitude: unknown,
  action: string
) {
  if (site.latitude == null || site.longitude == null) return; // site non géolocalisé
  const lat = latitude == null || latitude === '' ? null : Number(latitude);
  const lng = longitude == null || longitude === '' ? null : Number(longitude);
  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) {
    throw new AppError(`Position GPS requise : ${action} doit être effectué(e) sur le site.`, 422);
  }
  const dist = distanceMeters(lat, lng, Number(site.latitude), Number(site.longitude));
  if (dist > geofenceRadiusM()) {
    throw new AppError(
      `Vous n'êtes pas sur le site ${site.code ?? ''} (à ${Math.round(dist)} m, max ${geofenceRadiusM()} m). ${action} autorisé(e) uniquement sur place.`.trim(),
      422
    );
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

    // Un technicien ne voit que les activités de SON entreprise (prestataire)
    // et de SON périmètre (équipe passive → catégories passives, active → actives).
    if (req.user!.role === 'TECHNICIEN') {
      const me = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { prestataireId: true, equipe: true },
      });
      where.prestataireId = me?.prestataireId ?? '__none__'; // sans prestataire → aucune activité
      if (me?.equipe) {
        where.categorie = { in: me.equipe === 'ACTIVE' ? ACTIVE_CATS : PASSIVE_CATS };
      }
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

    const { pieces: _pieces, site: _site, technicien: _tech, ...data } = req.body;
    if (data.datePlanifiee) data.datePlanifiee = new Date(data.datePlanifiee);

    const updated = await prisma.maintenance.update({ where: { id: req.params.id }, data });
    await auditLog(req.user!.id, 'UPDATE', 'maintenances', existing.id, data, req);
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

export async function deleteMaintenance(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.maintenance.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Maintenance introuvable', 404);
    await prisma.maintenance.delete({ where: { id: req.params.id } });
    await auditLog(req.user!.id, 'DELETE', 'maintenances', existing.id, {}, req);
    res.json({ success: true, message: 'Maintenance supprimée' });
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

    // Tout ticket doit être DÉMARRÉ sur le site.
    assertOnSite(existing.site, latitude, longitude, 'le démarrage');

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

    if (pieces?.length) {
      await prisma.pieceRechange.createMany({
        data: pieces.map((p) => ({ ...p, maintenanceId: existing.id })) as unknown as Prisma.PieceRechangeCreateManyInput[],
      });
    }

    // Photos prises sur place (carte GE, compteur CEET, activités)
    if (photos?.length) {
      await prisma.photo.createMany({
        data: photos
          .filter((p) => p && p.url && p.key)
          .map((p) => ({ entityType: 'maintenance', entityId: existing.id, url: p.url, minioKey: p.key })),
      });
    }

    let updated = await prisma.maintenance.update({
      where: { id: req.params.id },
      data: { statut: 'TERMINEE', dateFin, dureeMinutes, observations, signaturePath },
    });

    // Création des relevés énergie liés à la maintenance (un par source présente).
    // Les consommations sont CALCULÉES par différence avec le relevé précédent du site :
    //  - kWh CEET      = index compteur actuel − index précédent ;
    //  - heures GE     = index horaire actuel − index précédent ;
    //  - gasoil GE     = niveau cuve précédent + dépotages depuis − niveau actuel.
    let analyseEnergie: string | null = null;
    if (passive && sources.length) {
      const techId = existing.technicienId ?? req.user!.id;

      for (const source of sources) {
        if (source === 'GE') {
          // Cuve PARTAGÉE : un niveau + une conso gasoil calculés une seule fois,
          // rattachés au 1er relevé GE. Heures calculées PAR GE (compteurs distincts).
          const tank = num(e.volumeGasoilLitres);
          const geHours = (e.geHours ?? {}) as Record<string, unknown>;
          const groupes = existing.site.groupes ?? [];

          // Gasoil consommé (partagé) = dernier niveau cuve + dépotages depuis − niveau actuel.
          let gasoilConso: number | null = null;
          let gasoilCost: number | null = null;
          const prevTank = await prisma.releveEnergie.findFirst({
            where: { siteId: existing.siteId, source: 'GE', volumeGasoilLitres: { not: null }, maintenanceId: { not: existing.id } },
            orderBy: { dateReleve: 'desc' },
          });
          if (prevTank?.volumeGasoilLitres != null && tank != null) {
            const depots = await prisma.depotage.aggregate({
              where: { siteId: existing.siteId, dateDepotage: { gt: prevTank.dateReleve, lte: dateFin } },
              _sum: { volumeLitres: true },
            });
            const ajout = Number(depots._sum.volumeLitres ?? 0);
            gasoilConso = Math.max(0, Number(prevTank.volumeGasoilLitres) + ajout - tank);
            gasoilCost = Math.round(gasoilConso * GE_PARAMS.prixLitreFCFA);
          }

          // Un relevé par GE (ou un seul si aucun GE configuré).
          const cibles = groupes.length ? groupes : [null];
          let first = true;
          let expectedGasoil = 0; // litres attendus = Σ puissance × facteur charge × heures × conso spécifique
          let hasHeures = false;
          for (const g of cibles) {
            const hIndex = g ? num(geHours[g.id]) : num(e.indexHeuresGE);
            const prevGe = await prisma.releveEnergie.findFirst({
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
                // GE modélisé → sa puissance/statut ; sinon repli sur les champs GE du site.
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
            await prisma.releveEnergie.create({ data });
          }

          // Analyse de cohérence : gasoil consommé (cuve) vs attendu (heures × puissance).
          analyseEnergie = analyseGasoilCoherence({ consomme: gasoilConso, attendu: expectedGasoil, hasHeures, seuilPct: seuilEcartGasoilPct() });
        } else if (source === 'CEET') {
          const index = num(e.indexCompteur);
          const prev = await prisma.releveEnergie.findFirst({
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
          await prisma.releveEnergie.create({ data });
        } else if (source === 'SOLAIRE') {
          await prisma.releveEnergie.create({
            data: {
              siteId: existing.siteId, dateReleve: dateFin, source: 'SOLAIRE',
              technicienId: techId, maintenanceId: existing.id, puissanceKva: num(e.puissanceKva),
            },
          });
        }
      }
    }

    // Commentaire d'analyse de cohérence énergie (gasoil vs heures × puissance).
    if (analyseEnergie) {
      updated = await prisma.maintenance.update({
        where: { id: req.params.id },
        data: { analyseEnergie },
      });
    }

    // Génération + stockage du rapport PDF
    const full = await prisma.maintenance.findUnique({
      where: { id: req.params.id },
      include: { site: true, technicien: { select: { nom: true, prenom: true } }, pieces: true },
    });
    if (full) {
      const pdf = await generateMaintenancePdf(full);
      const stored = await uploadBuffer(pdf, `maintenance-${full.id}.pdf`, 'application/pdf', 'rapports');
      updated = await prisma.maintenance.update({
        where: { id: req.params.id },
        data: { rapportPdfPath: stored.key },
      });
    }

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

    const buffer = await buildXlsx(
      'Maintenances',
      [
        { header: 'Site', key: 'site', width: 18 },
        { header: 'Type', key: 'type', width: 12 },
        { header: 'Catégorie', key: 'categorie', width: 14 },
        { header: 'Équipement', key: 'equipement', width: 22 },
        { header: 'Statut', key: 'statut', width: 12 },
        { header: 'Technicien', key: 'technicien', width: 20 },
        { header: 'Planifiée', key: 'datePlanifiee', width: 18 },
        { header: 'Durée (min)', key: 'duree', width: 12 },
      ],
      rows.map((m) => ({
        site: m.site?.code ?? '',
        type: m.type,
        categorie: m.categorie,
        equipement: m.equipement,
        statut: m.statut,
        technicien: m.technicien ? `${m.technicien.prenom} ${m.technicien.nom}` : '',
        datePlanifiee: m.datePlanifiee.toLocaleString('fr-FR'),
        duree: m.dureeMinutes ?? '',
      }))
    );

    await auditLog(req.user!.id, 'EXPORT', 'maintenances', undefined, { count: rows.length }, req);
    setXlsxHeaders(res, 'maintenances.xlsx');
    res.send(buffer);
  } catch (err) { next(err); }
}
