import { Request, Response, NextFunction } from 'express';
import ExcelJS from 'exceljs';
import { PowerConfig, StatutGE, FormeCuve, Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { pick } from '../utils/pick';
import { paginate } from '../utils/paginator';
import { triListe } from '../utils/triListe';
import { auditLog } from '../services/audit.service';
import { cacheService } from '../services/cache.service';
import { calculerStockSite } from '../utils/calculator';
import { geParams, getNum, typesLiaison } from '../services/settings.service';
import { forecastSites } from '../services/replenishment.service';
import { buildXlsx, setXlsxHeaders } from '../utils/excel';
import { sendTabular, EXPORT_MAX } from '../utils/exporter';
import { generateEtiquettesQrPdf } from '../services/pdf.service';
import { sitePerimetre, assertSiteInPerimetre } from '../utils/perimetre';
import { descendantsTransmission, assertSansCycle } from '../utils/transmission';
import { ConfigCuve, cuveCalculable, hauteurMaxCm, volumeMaxLitres } from '../utils/cuve';

// Colonnes du modèle d'import / export (en-têtes normalisés → champ).
const IMPORT_COLUMNS = [
  { key: 'code', header: 'code' },
  { key: 'nom', header: 'nom' },
  { key: 'region', header: 'region' },
  { key: 'ville', header: 'ville' },
  { key: 'adresse', header: 'adresse' },
  { key: 'latitude', header: 'latitude' },
  { key: 'longitude', header: 'longitude' },
  { key: 'powerConfig', header: 'powerConfig' },
  { key: 'statutGE', header: 'statutGE' },
  { key: 'puissanceGEkva', header: 'puissanceGEkva' },
  { key: 'lot', header: 'lot' },
  { key: 'typePylone', header: 'typePylone' },
  { key: 'hasClimatiseur', header: 'climatiseur' },
  { key: 'hasExtincteurs', header: 'extincteurs' },
  { key: 'cuveVolumeLitres', header: 'cuveVolumeLitres' },
  { key: 'formeCuve', header: 'formeCuve' },
  { key: 'cuveDimensions', header: 'cuveDimensions' },
  { key: 'cuveLongueurCm', header: 'cuveLongueurCm' },
  { key: 'cuveLargeurCm', header: 'cuveLargeurCm' },
  { key: 'cuveHauteurCm', header: 'cuveHauteurCm' },
  { key: 'cuveDiametreCm', header: 'cuveDiametreCm' },
  { key: 'puissanceGE2', header: 'puissanceGE2' },
  { key: 'statutGE2', header: 'statutGE2' },
  { key: 'hasGardien', header: 'gardien' },
  { key: 'gardiennageNuitSeulement', header: 'gardienNuit' },
  { key: 'societeGardiennage', header: 'societeGardiennage' },
  { key: 'telephoneSite', header: 'telephoneSite' },
  { key: 'marqueGE', header: 'marqueGE' },
  { key: 'marqueGE2', header: 'marqueGE2' },
  { key: 'nodeId', header: 'nodeId' },
];

// Normalise un en-tête : minuscules, sans accents ni séparateurs.
const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

// Synonymes acceptés (normalisés) → champ Site.
const HEADER_ALIASES: Record<string, string> = {
  code: 'code',
  nom: 'nom', name: 'nom',
  region: 'region',
  ville: 'ville', city: 'ville',
  adresse: 'adresse', address: 'adresse',
  latitude: 'latitude', lat: 'latitude',
  longitude: 'longitude', lng: 'longitude', lon: 'longitude',
  powerconfig: 'powerConfig', configenergie: 'powerConfig', configurationenergie: 'powerConfig',
  statutge: 'statutGE',
  puissancegekva: 'puissanceGEkva', puissancekva: 'puissanceGEkva', kva: 'puissanceGEkva',
  lot: 'lot', codelot: 'lot', lotcode: 'lot',
  typepylone: 'typePylone', pylone: 'typePylone', pylon: 'typePylone',
  climatiseur: 'hasClimatiseur', clim: 'hasClimatiseur', hasclimatiseur: 'hasClimatiseur',
  extincteurs: 'hasExtincteurs', extincteur: 'hasExtincteurs', hasextincteurs: 'hasExtincteurs',
  cuvevolumelitres: 'cuveVolumeLitres', volumecuve: 'cuveVolumeLitres', volumegasoil: 'cuveVolumeLitres', capacitecuve: 'cuveVolumeLitres',
  formecuve: 'formeCuve', forme: 'formeCuve',
  cuvedimensions: 'cuveDimensions', dimensionscuve: 'cuveDimensions', dimensions: 'cuveDimensions',
  cuvelongueurcm: 'cuveLongueurCm', longueurcuve: 'cuveLongueurCm', longueurcuvecm: 'cuveLongueurCm',
  cuvelargeurcm: 'cuveLargeurCm', largeurcuve: 'cuveLargeurCm', largeurcuvecm: 'cuveLargeurCm',
  cuvehauteurcm: 'cuveHauteurCm', hauteurcuve: 'cuveHauteurCm', hauteurcuvecm: 'cuveHauteurCm',
  cuvediametrecm: 'cuveDiametreCm', diametrecuve: 'cuveDiametreCm', diametrecuvecm: 'cuveDiametreCm',
  puissancege2: 'puissanceGE2', puissgege2: 'puissanceGE2', kvage2: 'puissanceGE2',
  statutge2: 'statutGE2',
  gardien: 'hasGardien', hasgardien: 'hasGardien', agentsecurite: 'hasGardien', agentdesecurite: 'hasGardien',
  gardiennuit: 'gardiennageNuitSeulement', postedenuit: 'gardiennageNuitSeulement', nuitseulement: 'gardiennageNuitSeulement',
  nodeid: 'nodeId', enodeb: 'nodeId', enodebid: 'nodeId',
  societegardiennage: 'societeGardiennage', gardiennage: 'societeGardiennage', societedegardiennage: 'societeGardiennage',
  telephonesite: 'telephoneSite', telephone: 'telephoneSite', tel: 'telephoneSite', contact: 'telephoneSite',
  marquege: 'marqueGE', marque: 'marqueGE',
  marquege2: 'marqueGE2',
};

/**
 * @swagger
 * /sites:
 *   get:
 *     tags: [Sites]
 *     summary: Liste des sites avec filtres et pagination
 */
export async function getSites(req: Request, res: Response, next: NextFunction) {
  try {
    const { region, statut_ge, power_config, search, page = '1', limit = '20', sort = 'nom' } = req.query as Record<string, string>;

    const where: Record<string, unknown> = { isActive: true };
    if (region) where.region = region;
    if (statut_ge) where.statutGE = statut_ge;
    if (power_config) where.powerConfig = power_config;
    // Le code du site n'est plus exposé dans l'interface : la recherche porte
    // sur le nom et la localisation, jamais sur le code.
    if (search) where.OR = [
      { nom: { contains: search, mode: 'insensitive' } },
      { region: { contains: search, mode: 'insensitive' } },
    ];

    // Périmètre prestataire : tout utilisateur rattaché à un prestataire
    // (technicien COMME superviseur) ne voit que les sites de ses lots.
    Object.assign(where, await sitePerimetre(req.user!.id));

    // Mode « tous » (sélecteurs, liste mobile) : pas de pagination (le paginateur
    // plafonne à 200, ce qui tronquerait les sites au-delà).
    if ((req.query.all as string) === 'true') {
      const sites = await prisma.site.findMany({ where, orderBy: { nom: 'asc' }, take: 2000 });
      return res.json({ success: true, data: sites });
    }

    // Tri d'en-tête délégué (liste blanche — l'ancien `sort` libre partait tel
    // quel dans Prisma : une clé inconnue faisait un 500) ; défaut : nom.
    const triExplicite = triListe(
      { tri: req.query.tri ?? sort, sens: req.query.sens },
      {
        nom: (s) => ({ nom: s }),
        region: (s) => ({ region: s }),
        ville: (s) => ({ ville: s }),
        powerConfig: (s) => ({ powerConfig: s }),
        statutGE: (s) => ({ statutGE: s }),
        puissanceGEkva: (s) => ({ puissanceGEkva: s }),
        // Colonnes optionnelles (catalogue /config).
        typePylone: (s) => ({ typePylone: s }),
        cuveVolumeLitres: (s) => ({ cuveVolumeLitres: s }),
        telephoneSite: (s) => ({ telephoneSite: s }),
        gardiennage: (s) => ({ societeGardiennage: s }),
      },
      { nom: 'asc' }
    );

    const { data, meta } = await paginate(
      prisma.site,
      {
        where,
        orderBy: triExplicite ?? { nom: 'asc' },
        // La marque GE vit sur les groupes (pas sur le site) : nécessaire à la
        // colonne optionnelle « Marque GE » de la liste web.
        include: { groupes: { where: { isActive: true }, orderBy: { numero: 'asc' }, select: { numero: true, marque: true } } },
      },
      { page: parseInt(page), limit: parseInt(limit) }
    );

    res.json({ success: true, data, meta });
  } catch (err) { next(err); }
}

export async function getSiteById(req: Request, res: Response, next: NextFunction) {
  try {
    await assertSiteInPerimetre(req.user!.id, req.params.id);
    const site = await prisma.site.findUnique({
      where: { id: req.params.id },
      include: {
        lot: {
          include: {
            assignments: {
              include: { prestataire: { select: { id: true, nom: true, contactCommercial: true, contactTechnique: true } } },
              orderBy: { scope: 'asc' },
            },
          },
        },
        gardiennagePrestataire: { select: { id: true, nom: true, contactTechnique: true } },
        groupes: { where: { isActive: true }, orderBy: { numero: 'asc' } },
        baremage: { orderBy: { hauteurCm: 'asc' }, select: { hauteurCm: true, litres: true } },
        parentTransmission: { select: { id: true, nom: true } },
        enfantsTransmission: { where: { isActive: true }, select: { id: true, nom: true }, orderBy: { nom: 'asc' } },
      },
    });
    if (!site) throw new AppError('Site introuvable', 404);

    // État de la conversion hauteur → litres : calculable ?, volume théorique à
    // hauteur max, écart au volume nominal déclaré (contrôle de cohérence).
    const configCuve: ConfigCuve = {
      formeCuve: site.formeCuve,
      cuveLongueurCm: site.cuveLongueurCm != null ? Number(site.cuveLongueurCm) : null,
      cuveLargeurCm: site.cuveLargeurCm != null ? Number(site.cuveLargeurCm) : null,
      cuveHauteurCm: site.cuveHauteurCm != null ? Number(site.cuveHauteurCm) : null,
      cuveDiametreCm: site.cuveDiametreCm != null ? Number(site.cuveDiametreCm) : null,
      baremage: site.baremage.map((b) => ({ hauteurCm: Number(b.hauteurCm), litres: Number(b.litres) })),
    };
    const volumeTheorique = volumeMaxLitres(configCuve);
    const nominal = site.cuveVolumeLitres != null ? Number(site.cuveVolumeLitres) : null;
    const cuve = {
      calculable: volumeTheorique != null,
      hauteurMaxCm: hauteurMaxCm(configCuve),
      volumeTheoriqueLitres: volumeTheorique,
      // > 15 % d'écart entre volume calculé et nominal déclaré : dimensions ou
      // barème probablement faux — signalé dans la fiche, jamais bloquant.
      ecartNominalPct: volumeTheorique != null && nominal
        ? Math.round(Math.abs(volumeTheorique - nominal) / nominal * 1000) / 10
        : null,
    };

    // Compteur vidange par GE : dernier index horaire relevé + heures écoulées
    // depuis la dernière vidange confirmée (null si jamais enregistrée).
    const derniers = await prisma.releveEnergie.findMany({
      where: { source: 'GE', groupeId: { in: site.groupes.map((g) => g.id) }, indexHeuresGE: { not: null } },
      orderBy: { dateReleve: 'desc' },
      select: { groupeId: true, indexHeuresGE: true },
    });
    const idxMap = new Map<string, number>();
    for (const r of derniers) {
      if (r.groupeId && !idxMap.has(r.groupeId)) idxMap.set(r.groupeId, Number(r.indexHeuresGE));
    }
    const groupes = site.groupes.map((g) => ({
      ...g,
      dernierIndexHeures: idxMap.get(g.id) ?? null,
      heuresDepuisVidange:
        g.indexHeuresDerniereVidange != null && idxMap.has(g.id)
          ? Math.max(0, idxMap.get(g.id)! - Number(g.indexHeuresDerniereVidange))
          : null,
    }));
    res.json({
      success: true,
      data: { ...site, groupes, cuve, intervalleVidangeHeures: getNum('ge.intervalleVidangeHeures', 250) },
    });
  } catch (err) { next(err); }
}

/**
 * Remplace la table de barémage de la cuve d'un site (couples hauteur cm →
 * litres du certificat de jaugeage). Remplacement complet : la table est
 * courte (quelques dizaines de points) et l'édition partielle multiplierait
 * les incohérences (points orphelins d'un ancien barème).
 */
export async function replaceBaremage(req: Request, res: Response, next: NextFunction) {
  try {
    const site = await prisma.site.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!site) throw new AppError('Site introuvable', 404);

    const brut = (req.body as { points?: unknown }).points;
    if (!Array.isArray(brut) || brut.length > 500) throw new AppError('points : tableau attendu (500 max)', 400);
    const points = brut.map((p, i) => {
      const hauteurCm = Number((p as { hauteurCm?: unknown }).hauteurCm);
      const litres = Number((p as { litres?: unknown }).litres);
      if (!Number.isFinite(hauteurCm) || hauteurCm < 0 || !Number.isFinite(litres) || litres < 0) {
        throw new AppError(`Point ${i + 1} invalide : hauteurCm et litres numériques positifs requis`, 400);
      }
      return { hauteurCm: Math.round(hauteurCm * 10) / 10, litres: Math.round(litres * 10) / 10 };
    }).sort((a, b) => a.hauteurCm - b.hauteurCm);
    // Un barème est MONOTONE : hauteurs strictement croissantes (doublon =
    // erreur de saisie), litres jamais décroissants.
    for (let i = 1; i < points.length; i++) {
      if (points[i].hauteurCm === points[i - 1].hauteurCm) {
        throw new AppError(`Deux points à la même hauteur (${points[i].hauteurCm} cm)`, 400);
      }
      if (points[i].litres < points[i - 1].litres) {
        throw new AppError(`Litres décroissants à ${points[i].hauteurCm} cm : un barème est monotone`, 400);
      }
    }
    if (points.length === 1) throw new AppError('Un barème utilisable compte au moins 2 points (ou 0 pour l’effacer)', 400);

    await prisma.$transaction([
      prisma.baremageCuve.deleteMany({ where: { siteId: site.id } }),
      ...(points.length
        ? [prisma.baremageCuve.createMany({ data: points.map((p) => ({ ...p, siteId: site.id })) })]
        : []),
    ]);
    await auditLog(req.user!.id, 'UPDATE', 'sites', site.id, { baremage: `${points.length} point(s)` }, req);
    res.json({ success: true, data: { points: points.length } });
  } catch (err) { next(err); }
}

/**
 * Couverture de la campagne « cuves calculables » : combien de sites actifs
 * (hors sites sans GE, donc sans cuve) ont une conversion hauteur → litres
 * opérationnelle — et la liste de ceux qui restent à configurer.
 */
export async function getCouvertureCuves(req: Request, res: Response, next: NextFunction) {
  try {
    const perimetre = await sitePerimetre(req.user!.id);
    const sites = await prisma.site.findMany({
      where: { isActive: true, statutGE: { not: 'PAS_DE_GE' }, ...perimetre },
      select: {
        id: true, nom: true, region: true, formeCuve: true, cuveVolumeLitres: true,
        cuveLongueurCm: true, cuveLargeurCm: true, cuveHauteurCm: true, cuveDiametreCm: true,
        _count: { select: { baremage: true } },
        baremage: { orderBy: { hauteurCm: 'asc' }, select: { hauteurCm: true, litres: true } },
      },
    });
    const restants: { id: string; nom: string; region: string }[] = [];
    let configures = 0;
    for (const s of sites) {
      const ok = cuveCalculable({
        formeCuve: s.formeCuve,
        cuveLongueurCm: s.cuveLongueurCm != null ? Number(s.cuveLongueurCm) : null,
        cuveLargeurCm: s.cuveLargeurCm != null ? Number(s.cuveLargeurCm) : null,
        cuveHauteurCm: s.cuveHauteurCm != null ? Number(s.cuveHauteurCm) : null,
        cuveDiametreCm: s.cuveDiametreCm != null ? Number(s.cuveDiametreCm) : null,
        baremage: s.baremage.map((b) => ({ hauteurCm: Number(b.hauteurCm), litres: Number(b.litres) })),
      });
      if (ok) configures++;
      else restants.push({ id: s.id, nom: s.nom, region: s.region });
    }
    restants.sort((a, b) => a.region.localeCompare(b.region) || a.nom.localeCompare(b.nom));
    res.json({ success: true, data: { total: sites.length, configures, restants } });
  } catch (err) { next(err); }
}

/** Topologie de transmission d'un site : parent et AVAL complet (récursif). */
/**
 * Rattachement de transmission d'UN site (parent + type de liaison) — le geste
 * du NOC quand il découvre une liaison, sans lui ouvrir toute la fiche site.
 */
export async function updateSiteTransmission(req: Request, res: Response, next: NextFunction) {
  try {
    const site = await prisma.site.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!site) throw new AppError('Site introuvable', 404);

    const b = req.body as { parentTransmissionId?: string | null; typeLiaison?: string | null };
    const parentId = b.parentTransmissionId || null;
    const liaison = b.typeLiaison || null;
    if (parentId) {
      if (parentId === site.id) throw new AppError('Un site ne peut pas être son propre amont', 400);
      const parent = await prisma.site.findUnique({ where: { id: parentId }, select: { id: true } });
      if (!parent) throw new AppError('Site amont introuvable', 404);
      await assertSansCycle(site.id, parentId);
    }
    if (liaison && !typesLiaison().some((t) => t.code === liaison)) {
      throw new AppError(`Type de liaison inconnu « ${liaison} »`, 400);
    }

    const updated = await prisma.site.update({
      where: { id: site.id },
      data: { parentTransmissionId: parentId, typeLiaison: parentId ? liaison : null },
      select: { id: true, parentTransmissionId: true, typeLiaison: true },
    });
    await auditLog(req.user!.id, 'UPDATE', 'sites', site.id, { transmission: { parentId, liaison } }, req);
    await cacheService.invalidate('sites:geojson*');
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

export async function getSiteTransmission(req: Request, res: Response, next: NextFunction) {
  try {
    await assertSiteInPerimetre(req.user!.id, req.params.id);
    const site = await prisma.site.findUnique({
      where: { id: req.params.id },
      select: { id: true, nom: true, typeLiaison: true, parentTransmissionId: true, parentTransmission: { select: { id: true, nom: true } } },
    });
    if (!site) throw new AppError('Site introuvable', 404);
    const aval = await descendantsTransmission(site.id);

    // CHAÎNE AMONT complète (site → … → racine) : chaque maillon porte le type
    // de la liaison qui le relie à SON propre amont. Avec l'état de coupure de
    // chaque maillon, la fiche montre PAR OÙ passe le site — et où ça casse.
    type Maillon = { id: string; code: string; nom: string; typeLiaison: string | null };
    const amont: Maillon[] = [];
    const vus = new Set<string>([site.id]);
    let parentId = site.parentTransmissionId;
    while (parentId && !vus.has(parentId) && amont.length < 30) {
      const p = await prisma.site.findUnique({
        where: { id: parentId },
        select: { id: true, code: true, nom: true, typeLiaison: true, parentTransmissionId: true },
      });
      if (!p) break;
      vus.add(p.id);
      amont.push({ id: p.id, code: p.code, nom: p.nom, typeLiaison: p.typeLiaison ?? null });
      parentId = p.parentTransmissionId;
    }

    // Coupures EN COURS sur la chaîne (site compris) : technos coupées par maillon.
    const idsChaine = [site.id, ...amont.map((m) => m.id)];
    const coupures = await prisma.coupureReseau.findMany({
      where: { siteId: { in: idsChaine }, dateFin: null },
      select: { siteId: true, technologie: true },
    });
    const technosCoupees: Record<string, string[]> = {};
    for (const c of coupures) {
      (technosCoupees[c.siteId] ??= []).push(c.technologie);
    }

    res.json({
      success: true,
      data: { parent: site.parentTransmission, aval, amont, liaisonDuSite: site.typeLiaison ?? null, technosCoupees },
    });
  } catch (err) { next(err); }
}

export async function createSite(req: Request, res: Response, next: NextFunction) {
  try {
    // marqueGE ne vit pas sur le site : extraite du corps, posée sur le GE n°1.
    const marqueGE = (req.body as { marqueGE?: string }).marqueGE;
    // Liste blanche stricte (mêmes champs que updateSite) : jamais isActive/
    // createdAt/relations arbitraires injectés à la création.
    const data = pick<Prisma.SiteUncheckedCreateInput>(req.body, [
      'nom', 'code', 'region', 'ville', 'adresse', 'latitude', 'longitude',
      'powerConfig', 'statutGE', 'puissanceGEkva', 'lotId', 'typePylone',
      'hasClimatiseur', 'hasExtincteurs', 'cuveVolumeLitres', 'formeCuve',
      'cuveDimensions', 'cuveLongueurCm', 'cuveLargeurCm', 'cuveHauteurCm', 'cuveDiametreCm', 'hasGardien', 'gardiennageNuitSeulement', 'societeGardiennage', 'telephoneSite', 'gardiennagePrestataireId',
      'parentTransmissionId', 'typeLiaison', 'nodeId',
    ]);
    if (!data.nom || !data.code || !data.region || !data.powerConfig || !data.statutGE) {
      throw new AppError('Nom, code, région, configuration énergie et statut GE sont requis.', 400);
    }
    const site = await prisma.site.create({ data: data as Prisma.SiteUncheckedCreateInput });
    // Crée automatiquement le GE n°1 si le site a un GE (cohérence avec la table dédiée).
    if (site.statutGE !== 'PAS_DE_GE') {
      await prisma.groupeElectrogene.create({
        data: {
          siteId: site.id, numero: 1, puissanceKva: site.puissanceGEkva, statut: site.statutGE,
          marque: marqueGE?.trim() ? marqueGE.trim() : null, isActive: true,
        },
      });
    }
    await auditLog(req.user!.id, 'CREATE', 'sites', site.id, req.body, req);
    await cacheService.invalidate('sites:geojson*');
    res.status(201).json({ success: true, data: site });
  } catch (err) { next(err); }
}

export async function updateSite(req: Request, res: Response, next: NextFunction) {
  try {
    const site = await prisma.site.findUnique({ where: { id: req.params.id } });
    if (!site) throw new AppError('Site introuvable', 404);
    // Liste blanche : jamais de isActive/createdAt/marqueGE arbitraires ici.
    const data = pick<Prisma.SiteUncheckedUpdateInput>(req.body, [
      'nom', 'code', 'region', 'ville', 'adresse', 'latitude', 'longitude',
      'powerConfig', 'statutGE', 'puissanceGEkva', 'lotId', 'typePylone',
      'hasClimatiseur', 'hasExtincteurs', 'cuveVolumeLitres', 'formeCuve',
      'cuveDimensions', 'cuveLongueurCm', 'cuveLargeurCm', 'cuveHauteurCm', 'cuveDiametreCm', 'hasGardien', 'gardiennageNuitSeulement', 'societeGardiennage', 'telephoneSite', 'gardiennagePrestataireId',
      'parentTransmissionId', 'typeLiaison', 'nodeId',
    ]);
    if (Object.keys(data).length === 0) throw new AppError('Aucun champ modifiable fourni.', 400);
    // Topologie : un parent de transmission ne doit jamais créer de cycle.
    if (typeof data.parentTransmissionId === 'string' && data.parentTransmissionId) {
      await assertSansCycle(site.id, data.parentTransmissionId);
    }
    const updated = await prisma.site.update({ where: { id: req.params.id }, data });
    await auditLog(req.user!.id, 'UPDATE', 'sites', site.id, { after: data }, req);
    await cacheService.invalidate('sites:geojson*');
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

/**
 * Remplace la liste des groupes électrogènes d'un site (upsert par numéro,
 * désactivation des GE retirés — sans suppression pour préserver l'historique
 * des relevés). Synchronise le « GE principal » du site (statut/puissance) sur
 * le GE #1, utilisé par le calcul de stock et les listes.
 */
export async function replaceSiteGroupes(req: Request, res: Response, next: NextFunction) {
  try {
    const siteId = req.params.id;
    const site = await prisma.site.findUnique({ where: { id: siteId }, select: { id: true } });
    if (!site) throw new AppError('Site introuvable', 404);

    const groupes = (Array.isArray(req.body) ? req.body : req.body?.groupes) as
      | Array<{ numero: number; puissanceKva?: number; statut?: string; marque?: string }>
      | undefined;
    if (!Array.isArray(groupes)) throw new AppError('Liste de groupes électrogènes attendue.', 422);

    const STATUTS = Object.values(StatutGE) as string[];
    const numeros: number[] = [];
    for (const g of groupes) {
      const numero = Number(g.numero);
      if (!Number.isInteger(numero) || numero < 1) throw new AppError('Numéro de GE invalide.', 422);
      if (numeros.includes(numero)) throw new AppError(`Numéro de GE en double : ${numero}.`, 422);
      numeros.push(numero);
      const statut = (g.statut && STATUTS.includes(g.statut) ? g.statut : 'GE_SECOURS') as StatutGE;
      const puissanceKva = Number(g.puissanceKva) || 0;
      const marque = g.marque?.trim() ? g.marque.trim() : null;
      await prisma.groupeElectrogene.upsert({
        where: { siteId_numero: { siteId, numero } },
        create: { siteId, numero, puissanceKva, statut, marque, isActive: true },
        update: { puissanceKva, statut, marque, isActive: true },
      });
    }
    // GE retirés → désactivés (historique préservé).
    await prisma.groupeElectrogene.updateMany({
      where: { siteId, isActive: true, numero: { notIn: numeros } },
      data: { isActive: false },
    });

    // Synchronise le GE principal du site (compat stock/listes/filtres).
    const principal = groupes.find((g) => Number(g.numero) === 1) ?? groupes[0];
    await prisma.site.update({
      where: { id: siteId },
      data: principal
        ? { statutGE: ((principal.statut as StatutGE) ?? 'GE_SECOURS'), puissanceGEkva: Number(principal.puissanceKva) || 0 }
        : { statutGE: 'PAS_DE_GE', puissanceGEkva: 0 },
    });

    await auditLog(req.user!.id, 'UPDATE', 'sites', siteId, { groupes }, req);
    await cacheService.invalidate('sites:geojson*');
    const data = await prisma.groupeElectrogene.findMany({ where: { siteId, isActive: true }, orderBy: { numero: 'asc' } });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function deleteSite(req: Request, res: Response, next: NextFunction) {
  try {
    const site = await prisma.site.findUnique({ where: { id: req.params.id } });
    if (!site) throw new AppError('Site introuvable', 404);
    await prisma.site.update({ where: { id: req.params.id }, data: { isActive: false } });
    await auditLog(req.user!.id, 'DELETE', 'sites', site.id, {}, req);
    await cacheService.invalidate('sites:geojson*');
    res.json({ success: true, message: 'Site désactivé' });
  } catch (err) { next(err); }
}

/** Modèle xlsx d'import (en-têtes + une ligne d'exemple). */
export async function sitesImportTemplate(_req: Request, res: Response, next: NextFunction) {
  try {
    const buffer = await buildXlsx('Sites', IMPORT_COLUMNS, [
      {
        code: 'MAR-001', nom: 'Site Exemple', region: 'Maritime', ville: 'Lomé',
        adresse: 'Quartier X', latitude: 6.1725, longitude: 1.2314,
        powerConfig: 'CEET_GE', statutGE: 'GE_SECOURS', puissanceGEkva: 100, lot: 'LOT-01',
        typePylone: 'GREENFIELD', hasClimatiseur: 'oui', hasExtincteurs: 'oui',
        cuveVolumeLitres: 2000, formeCuve: 'CYLINDRE_COUCHE', cuveDimensions: '2m x 1m x 1m',
        // Dimensions INTERNES en cm : cylindre couché = diamètre + longueur ; rectangulaire = longueur + largeur + hauteur.
        cuveLongueurCm: 255, cuveLargeurCm: '', cuveHauteurCm: '', cuveDiametreCm: 100,
        puissanceGE2: '', statutGE2: '', // remplir pour un 2e GE (ex: 100 / GE_SECOURS)
        hasGardien: 'oui', gardiennageNuitSeulement: 'non', societeGardiennage: 'SECURITOGO', telephoneSite: '+228 90 00 00 00',
        marqueGE: 'CATERPILLAR', marqueGE2: '',
        nodeId: '2848', // identifiant eNodeB OSS (615-03-Macro-2848)
      },
    ]);
    setXlsxHeaders(res, 'modele_import_sites.xlsx');
    res.send(buffer);
  } catch (err) { next(err); }
}

/**
 * Import en masse de sites depuis un .xlsx. Upsert par `code` :
 * code existant → mise à jour, sinon création. Renvoie un récapitulatif.
 */
export async function importSites(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) throw new AppError('Aucun fichier reçu (champ "file").', 400);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.file.buffer as unknown as ArrayBuffer, {
      // Les nœuds de présentation (styles, images, mises en forme) représentent
      // l'essentiel de la mémoire d'un .xlsx : 10 Mo de fichier donnaient
      // 300-600 Mo de heap pour un conteneur limité à 1 Go.
      ignoreNodes: ['dataValidations', 'drawing', 'hyperlinks', 'picture', 'styles', 'conditionalFormatting'],
    });
    const ws = wb.worksheets[0];
    if (!ws || ws.rowCount < 2) throw new AppError('Fichier vide ou sans données.', 400);

    // En-têtes (ligne 1) → index de colonne par champ Site.
    const colByField: Record<string, number> = {};
    ws.getRow(1).eachCell((cell, col) => {
      const field = HEADER_ALIASES[norm(String(cell.value ?? ''))];
      if (field) colByField[field] = col;
    });
    if (colByField.code == null) {
      throw new AppError('Colonne "code" introuvable. Utilisez le modèle d\'import.', 422);
    }

    // Tous les sites existants en UNE requête (clé : code) — l'import faisait
    // 5 à 6 allers-retours SQL par ligne, soit ~90 s et un état à moitié
    // importé en cas d'échec à 5 000 sites.
    const tousSites = await prisma.site.findMany({ select: { id: true, code: true } });
    const codesExistants = new Map(tousSites.map((x) => [x.code, x]));

    const POWER = Object.values(PowerConfig) as string[];
    const STATUT = Object.values(StatutGE) as string[];
    // Résolution tolérante des enums/référentiels (insensible casse/accents/tirets).
    // Types de pylône : référentiel éditable — accepté par code OU par libellé.
    const typesPylone = await prisma.typePyloneRef.findMany();
    const pyloneByNorm = new Map<string, string>();
    for (const t of typesPylone) {
      pyloneByNorm.set(norm(t.code), t.code);
      pyloneByNorm.set(norm(t.libelle), t.code);
    }
    const formeByNorm = new Map((Object.values(FormeCuve) as string[]).map((v) => [norm(v), v]));
    const TRUE_SET = new Set(['1', 'oui', 'true', 'vrai', 'x', 'yes', 'y']);
    const toBool = (s: string) => TRUE_SET.has(norm(s));

    // Préchargement des lots pour résoudre le rattachement (par code, puis nom).
    const lots = await prisma.lot.findMany({ select: { id: true, code: true, nom: true } });
    const lotByKey = new Map<string, string>();
    for (const l of lots) {
      lotByKey.set(norm(l.code), l.id);
      lotByKey.set(norm(l.nom), l.id);
    }
    const cellText = (row: ExcelJS.Row, field: string): string => {
      const col = colByField[field];
      if (col == null) return '';
      return String(row.getCell(col).text ?? '').trim();
    };
    const numOrNull = (v: string): number | null => (v === '' || Number.isNaN(Number(v)) ? null : Number(v));

    const results = { total: 0, created: 0, updated: 0, errors: [] as { ligne: number; code: string; message: string }[] };

    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const code = cellText(row, 'code');
      // Ligne entièrement vide → on ignore.
      if (!code && !cellText(row, 'nom')) continue;
      results.total++;
      try {
        if (!code) throw new Error('code manquant');
        const nom = cellText(row, 'nom');
        const region = cellText(row, 'region');
        if (!nom) throw new Error('nom manquant');
        if (!region) throw new Error('region manquante');

        const powerConfig = cellText(row, 'powerConfig') || 'CEET_GE';
        if (!POWER.includes(powerConfig)) throw new Error(`powerConfig invalide « ${powerConfig} » (attendu : ${POWER.join(', ')})`);
        const statutGE = cellText(row, 'statutGE') || 'GE_SECOURS';
        if (!STATUT.includes(statutGE)) throw new Error(`statutGE invalide « ${statutGE} » (attendu : ${STATUT.join(', ')})`);

        // Rattachement au lot (optionnel). Colonne vide → lotId inchangé (préservé en update).
        let lotId: string | undefined;
        const lotRef = cellText(row, 'lot');
        if (lotRef) {
          lotId = lotByKey.get(norm(lotRef));
          if (!lotId) throw new Error(`lot introuvable « ${lotRef} » (code de lot attendu)`);
        }

        // Infrastructure (toutes optionnelles). Colonne vide → champ préservé en update.
        let typePylone: string | undefined;
        const tp = cellText(row, 'typePylone');
        if (tp) {
          const found = pyloneByNorm.get(norm(tp));
          if (!found) throw new Error(`type pylône inconnu « ${tp} » (gérez la liste dans Administration → Types de pylône)`);
          typePylone = found;
        }
        let formeCuve: FormeCuve | undefined;
        const fc = cellText(row, 'formeCuve');
        if (fc) {
          const found = formeByNorm.get(norm(fc));
          if (!found) throw new Error(`forme cuve invalide « ${fc} » (Rectangulaire ou Cylindre couché)`);
          formeCuve = found as FormeCuve;
        }
        const cuveVol = numOrNull(cellText(row, 'cuveVolumeLitres'));
        const cuveDim = cellText(row, 'cuveDimensions');

        const data = {
          nom,
          region,
          ville: cellText(row, 'ville') || null,
          adresse: cellText(row, 'adresse') || null,
          latitude: numOrNull(cellText(row, 'latitude')),
          longitude: numOrNull(cellText(row, 'longitude')),
          powerConfig: powerConfig as PowerConfig,
          statutGE: statutGE as StatutGE,
          puissanceGEkva: numOrNull(cellText(row, 'puissanceGEkva')) ?? 0,
          lotId,
          typePylone,
          formeCuve,
          cuveVolumeLitres: cuveVol,
          cuveDimensions: cuveDim || null,
          // Booléens : seulement si la colonne existe (sinon on préserve l'existant).
          ...(colByField.hasClimatiseur != null ? { hasClimatiseur: toBool(cellText(row, 'hasClimatiseur')) } : {}),
          ...(colByField.hasExtincteurs != null ? { hasExtincteurs: toBool(cellText(row, 'hasExtincteurs')) } : {}),
          ...(colByField.hasGardien != null ? { hasGardien: toBool(cellText(row, 'hasGardien')) } : {}),
          ...(colByField.gardiennageNuitSeulement != null ? { gardiennageNuitSeulement: toBool(cellText(row, 'gardiennageNuitSeulement')) } : {}),
          ...(colByField.societeGardiennage != null ? { societeGardiennage: cellText(row, 'societeGardiennage') || null } : {}),
          ...(colByField.telephoneSite != null ? { telephoneSite: cellText(row, 'telephoneSite') || null } : {}),
          // Dimensions internes de la cuve (cm) — conversion hauteur → litres.
          ...(colByField.cuveLongueurCm != null ? { cuveLongueurCm: numOrNull(cellText(row, 'cuveLongueurCm')) } : {}),
          ...(colByField.cuveLargeurCm != null ? { cuveLargeurCm: numOrNull(cellText(row, 'cuveLargeurCm')) } : {}),
          ...(colByField.cuveHauteurCm != null ? { cuveHauteurCm: numOrNull(cellText(row, 'cuveHauteurCm')) } : {}),
          ...(colByField.cuveDiametreCm != null ? { cuveDiametreCm: numOrNull(cellText(row, 'cuveDiametreCm')) } : {}),
          // NodeID OSS (rapprochement de la détection automatique des coupures).
          ...(colByField.nodeId != null ? { nodeId: cellText(row, 'nodeId') || null } : {}),
          isActive: true,
        };

        // Préchargé en une requête (voir `codesExistants`) : un findUnique par
      // ligne, c'était 800 allers-retours pour un import de parc.
      const existing = codesExistants.get(code) ?? null;
        let siteId: string;
        if (existing) {
          const upd = await prisma.site.update({ where: { code }, data });
          siteId = upd.id;
          results.updated++;
        } else {
          const cre = await prisma.site.create({ data: { ...data, code } });
          siteId = cre.id;
          // Ajouté à l'index : un même code répété plus bas dans le fichier doit
          // être traité comme une mise à jour, pas comme une seconde création.
          codesExistants.set(code, { id: cre.id, code });
          results.created++;
        }
        // Synchronise le GE n°1 depuis statut/puissance (table dédiée).
        if (data.statutGE !== 'PAS_DE_GE') {
          await prisma.groupeElectrogene.upsert({
            where: { siteId_numero: { siteId, numero: 1 } },
            create: { siteId, numero: 1, puissanceKva: data.puissanceGEkva, statut: data.statutGE, isActive: true, marque: cellText(row, 'marqueGE') || null },
            update: { puissanceKva: data.puissanceGEkva, statut: data.statutGE, isActive: true,
              ...(colByField.marqueGE != null ? { marque: cellText(row, 'marqueGE') || null } : {}) },
          });
        } else {
          await prisma.groupeElectrogene.updateMany({ where: { siteId, numero: 1 }, data: { isActive: false } });
        }
        // GE n°2 optionnel (colonnes puissanceGE2 / statutGE2).
        const statutGE2raw = cellText(row, 'statutGE2');
        const puissGE2 = numOrNull(cellText(row, 'puissanceGE2'));
        if (statutGE2raw || puissGE2 != null) {
          const statutGE2 = statutGE2raw || 'GE_SECOURS';
          if (!STATUT.includes(statutGE2)) throw new Error(`statutGE2 invalide « ${statutGE2} » (attendu : ${STATUT.join(', ')})`);
          await prisma.groupeElectrogene.upsert({
            where: { siteId_numero: { siteId, numero: 2 } },
            create: { siteId, numero: 2, puissanceKva: puissGE2 ?? 0, statut: statutGE2 as StatutGE, isActive: true, marque: cellText(row, 'marqueGE2') || null },
            update: { puissanceKva: puissGE2 ?? 0, statut: statutGE2 as StatutGE, isActive: true,
              ...(colByField.marqueGE2 != null ? { marque: cellText(row, 'marqueGE2') || null } : {}) },
          });
        } else {
          await prisma.groupeElectrogene.updateMany({ where: { siteId, numero: 2 }, data: { isActive: false } });
        }
      } catch (e) {
        results.errors.push({ ligne: r, code, message: e instanceof Error ? e.message : 'Erreur inconnue' });
      }
    }

    await auditLog(req.user!.id, 'CREATE', 'sites', 'bulk-import', { fichier: req.file.originalname, ...results }, req);
    await cacheService.invalidate('sites:geojson*');
    res.json({ success: true, data: results });
  } catch (err) { next(err); }
}

/** GeoJSON pour Leaflet — avec mise en cache Redis 5min */
export async function getSitesGeoJSON(req: Request, res: Response, next: NextFunction) {
  try {
    // ── Vue TRANSPORTEUR : la carte de SES livraisons, données minimales ──
    // Le transporteur a besoin de LOCALISER les sites à servir (itinéraire),
    // pas de l'état d'exploitation. Les niveaux de cuve, autonomies et dates
    // de rupture révèlent où se trouve le carburant — exactement l'information
    // qu'on ne met pas entre toutes les mains. L'info-bulle se limite donc au
    // site et à ce que SON plan prévoit encore d'y déposer.
    if (req.user!.role === 'TRANSPORTEUR') {
      const me = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { prestataireId: true } });
      if (!me?.prestataireId) throw new AppError("Votre compte n'est rattaché à aucun transporteur", 403);

      const lignes = await prisma.ligneLivraison.findMany({
        where: {
          statut: { in: ['PREVU', 'PARTIEL'] },
          bonLivraison: { transporteurId: me.prestataireId, statut: { not: 'ANNULE' }, isBrouillon: false, dateCloture: null },
          site: { isActive: true, latitude: { not: null }, longitude: { not: null } },
        },
        select: {
          volumePrevuLitres: true,
          depotages: { select: { volumeLitres: true } },
          bonLivraison: { select: { numeroBL: true, immatriculation: true } },
          site: { select: { id: true, nom: true, code: true, region: true, latitude: true, longitude: true } },
        },
      });

      type SiteLite = (typeof lignes)[number]['site'];
      type Livraison = { immatriculation: string; numeroBL: string; restant: number };
      const parSite = new Map<string, { site: SiteLite; aLivrer: number; bls: Set<string>; livraisons: Livraison[] }>();
      for (const l of lignes) {
        const livre = l.depotages.reduce((t, d) => t + Number(d.volumeLitres), 0);
        const restant = Math.max(0, Number(l.volumePrevuLitres) - livre);
        if (restant <= 0.5) continue; // ligne soldée : plus rien à y déposer
        const a = parSite.get(l.site.id) ?? { site: l.site, aLivrer: 0, bls: new Set<string>(), livraisons: [] };
        a.aLivrer += restant;
        a.bls.add(l.bonLivraison.numeroBL);
        // Détail PAR CAMION : plusieurs camions du même transporteur peuvent
        // desservir le même site — la carte doit dire lequel apporte quoi.
        a.livraisons.push({
          immatriculation: l.bonLivraison.immatriculation,
          numeroBL: l.bonLivraison.numeroBL,
          restant: Math.round(restant),
        });
        parSite.set(l.site.id, a);
      }

      // Pas de cache : requête petite, propre à l'utilisateur, et le plan
      // change plus vite que les 5 min du cache de la carte interne.
      return res.json({
        type: 'FeatureCollection',
        vue: 'transporteur',
        features: [...parSite.values()].map(({ site, aLivrer, bls, livraisons }) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [Number(site.longitude), Number(site.latitude)] },
          properties: {
            id: site.id, nom: site.nom, code: site.code, region: site.region,
            // Champs requis par le type SiteFeature, neutralisés : rien de
            // l'exploitation ne sort sur cette vue.
            statutGE: '', powerConfig: '', puissanceGEkva: 0, hasStock: false, niveauStock: 'NA',
            aLivrerLitres: Math.round(aLivrer),
            numerosBL: [...bls].sort(),
            camions: [...new Set(livraisons.map((x) => x.immatriculation))].sort(),
            livraisons: livraisons.sort((x, y) => x.immatriculation.localeCompare(y.immatriculation)),
          },
        })),
      });
    }

    // Même périmètre que la liste des sites : un utilisateur rattaché à un
    // prestataire ne voit sur la carte QUE les sites des lots de sa société.
    // Le cache est décliné par périmètre pour ne jamais servir la carte
    // restreinte d'un prestataire à un interne (ni l'inverse).
    const perimetre = await sitePerimetre(req.user!.id);
    const restreint = Object.keys(perimetre).length > 0;
    const me = restreint ? await prisma.user.findUnique({ where: { id: req.user!.id }, select: { prestataireId: true } }) : null;
    const cacheKey = me?.prestataireId ? `sites:geojson:p:${me.prestataireId}` : 'sites:geojson';
    const cached = await cacheService.get(cacheKey);
    if (cached) return res.json(cached);

    const sites = await prisma.site.findMany({
      where: {
        isActive: true, latitude: { not: null }, longitude: { not: null },
        ...perimetre,
      },
      select: { id: true, nom: true, code: true, region: true, statutGE: true, powerConfig: true, puissanceGEkva: true, latitude: true, longitude: true },
    });

    // Dernier niveau de cuve (relevé GE) par site → présence + niveau d'alerte stock.
    const releves = await prisma.releveEnergie.findMany({
      where: { source: 'GE', volumeGasoilLitres: { not: null } },
      orderBy: { dateReleve: 'desc' },
      select: { siteId: true, volumeGasoilLitres: true },
    });
    const stockMap = new Map<string, number>();
    for (const r of releves) if (!stockMap.has(r.siteId)) stockMap.set(r.siteId, Number(r.volumeGasoilLitres));
    const gp = geParams();

    // Dernier dépotage par site (volume + date).
    const siteIds = sites.map((s) => s.id);
    const lastDepots = siteIds.length
      ? await prisma.depotage.findMany({
          where: { siteId: { in: siteIds } },
          orderBy: { dateDepotage: 'desc' },
          distinct: ['siteId'],
          select: { siteId: true, volumeLitres: true, dateDepotage: true },
        })
      : [];
    const depotMap = new Map(lastDepots.map((d) => [d.siteId, d]));

    // Prévision par site (stock estimé à date, autonomie, rupture, tendance) — mémoïsée.
    const forecasts = await forecastSites({ all: true });
    const fcMap = new Map(forecasts.map((f) => [f.siteId, f]));

    const geojson = {
      type: 'FeatureCollection',
      features: sites.map(site => {
        const rawStock = stockMap.has(site.id) ? stockMap.get(site.id)! : null;
        const fc = fcMap.get(site.id);
        // Niveau d'alerte (couleur marqueur + filtre) basé sur le stock ESTIMÉ à date,
        // avec repli sur la dernière jauge mesurée si aucune prévision.
        const stockRef = fc ? fc.stockActuel : rawStock;
        const niveau = calculerStockSite(site, stockRef != null ? { volumeGasoilLitres: stockRef } : null, gp);
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [Number(site.longitude), Number(site.latitude)] },
          properties: {
            id: site.id, nom: site.nom, code: site.code, region: site.region,
            statutGE: site.statutGE, powerConfig: site.powerConfig,
            puissanceGEkva: Number(site.puissanceGEkva),
            hasStock: rawStock != null,
            stockLitres: rawStock != null ? Math.round(rawStock) : 0, // dernier relevé mesuré
            niveauStock: niveau.niveauAlerte, // OK / FAIBLE / CRITIQUE / VIDE / NA (sur l'estimation)
            // Estimation à date (prévision) — null si site sans GE / sans données exploitables.
            derniereMesure: fc?.derniereMesure ?? null,
            stockEstime: fc ? fc.stockActuel : null,
            autonomieJours: fc?.autonomieJours ?? null,
            dateRupture: fc?.dateRupture ?? null,
            tendance: fc?.tendance ?? null,
            // Source de l'estimation : l'info-bulle doit dire si le chiffre est
            // mesuré ou supposé (même code couleur que la page Réappro).
            sourceConso: fc?.source ?? null,
            heuresGEJour: fc?.heuresGEJour ?? null,
            // Dernier dépotage.
            dernierDepotageVol: depotMap.has(site.id) ? Number(depotMap.get(site.id)!.volumeLitres) : null,
            dernierDepotageDate: depotMap.get(site.id)?.dateDepotage.toISOString() ?? null,
          },
        };
      }),
    };

    await cacheService.set(cacheKey, geojson, 300); // 5 min
    res.json(geojson);
  } catch (err) { next(err); }
}

/** Stock actuel d'un site (dernier relevé gasoil) */
export async function getSiteStock(req: Request, res: Response, next: NextFunction) {
  try {
    await assertSiteInPerimetre(req.user!.id, req.params.id);
    const site = await prisma.site.findUnique({ where: { id: req.params.id } });
    if (!site) throw new AppError('Site introuvable', 404);

    const dernierReleve = await prisma.releveEnergie.findFirst({
      where: { siteId: req.params.id, source: 'GE' },
      orderBy: { dateReleve: 'desc' },
    });

    const stock = calculerStockSite(site, dernierReleve, geParams());
    res.json({ success: true, data: stock });
  } catch (err) { next(err); }
}

export async function getSiteMaintenances(req: Request, res: Response, next: NextFunction) {
  try {
    await assertSiteInPerimetre(req.user!.id, req.params.id);
    const { page = '1', limit = '20' } = req.query as Record<string, string>;
    const { data, meta } = await paginate(
      prisma.maintenance,
      { where: { siteId: req.params.id }, orderBy: { datePlanifiee: 'desc' }, include: { technicien: { select: { nom: true, prenom: true } } } },
      { page: parseInt(page), limit: parseInt(limit) }
    );
    res.json({ success: true, data, meta });
  } catch (err) { next(err); }
}

export async function getSiteDepotages(req: Request, res: Response, next: NextFunction) {
  try {
    await assertSiteInPerimetre(req.user!.id, req.params.id);
    const { page = '1', limit = '20' } = req.query as Record<string, string>;
    const { data, meta } = await paginate(
      prisma.depotage,
      { where: { siteId: req.params.id }, orderBy: { dateDepotage: 'desc' } },
      { page: parseInt(page), limit: parseInt(limit) }
    );
    res.json({ success: true, data, meta });
  } catch (err) { next(err); }
}

export async function getSiteIncidents(req: Request, res: Response, next: NextFunction) {
  try {
    await assertSiteInPerimetre(req.user!.id, req.params.id);
    const { page = '1', limit = '20' } = req.query as Record<string, string>;
    const { data, meta } = await paginate(
      prisma.incident,
      { where: { siteId: req.params.id }, orderBy: { dateOuverture: 'desc' } },
      { page: parseInt(page), limit: parseInt(limit) }
    );
    res.json({ success: true, data, meta });
  } catch (err) { next(err); }
}

export async function getSiteReleves(req: Request, res: Response, next: NextFunction) {
  try {
    await assertSiteInPerimetre(req.user!.id, req.params.id);
    const { page = '1', limit = '20', source } = req.query as Record<string, string>;
    const where: Record<string, unknown> = { siteId: req.params.id };
    if (source) where.source = source;
    const { data, meta } = await paginate(
      prisma.releveEnergie,
      { where, orderBy: { dateReleve: 'desc' } },
      { page: parseInt(page), limit: parseInt(limit) }
    );
    res.json({ success: true, data, meta });
  } catch (err) { next(err); }
}

/** Export Excel de la liste des sites (avec filtres identiques à getSites). */
/**
 * Export du parc — MODÈLE DE MISE À JOUR : les colonnes sont exactement celles
 * de l'import (mêmes en-têtes), avec l'état réel des GE (parc actif). Le
 * cycle est donc : exporter → corriger dans Excel → réimporter (upsert par
 * code) — sans jamais reconstruire un fichier à la main.
 */
export async function exportSites(req: Request, res: Response, next: NextFunction) {
  try {
    const { region, statut_ge, power_config } = req.query as Record<string, string>;
    const where: Record<string, unknown> = { isActive: true };
    if (region) where.region = region;
    if (statut_ge) where.statutGE = statut_ge;
    if (power_config) where.powerConfig = power_config;
    // Superviseur prestataire : il exporte SES sites (mêmes colonnes — aucune
    // donnée financière dans ce fichier), jamais le parc entier.
    Object.assign(where, await sitePerimetre(req.user!.id));

    const sites = await prisma.site.findMany({
      where,
      take: EXPORT_MAX,
      orderBy: { code: 'asc' },
      include: {
        lot: { select: { code: true } },
        groupes: { where: { isActive: true }, orderBy: { numero: 'asc' }, select: { numero: true, puissanceKva: true, statut: true, marque: true } },
      },
    });

    await auditLog(req.user!.id, 'EXPORT', 'sites', undefined, { count: sites.length }, req);
    const oui = (b: boolean) => (b ? 'oui' : 'non');
    await sendTabular(res, req.params.format, 'sites', 'Parc de sites (modèle de mise à jour - ré-importable)', [{
      name: 'Sites',
      columns: IMPORT_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: 16 })),
      rows: sites.map((s) => {
        const ge1 = s.groupes[0];
        const ge2 = s.groupes[1];
        return {
          code: s.code,
          nom: s.nom,
          region: s.region,
          ville: s.ville ?? '',
          adresse: s.adresse ?? '',
          latitude: s.latitude != null ? Number(s.latitude) : '',
          longitude: s.longitude != null ? Number(s.longitude) : '',
          powerConfig: s.powerConfig,
          statutGE: ge1?.statut ?? s.statutGE,
          puissanceGEkva: ge1 ? Number(ge1.puissanceKva) : Number(s.puissanceGEkva),
          lot: s.lot?.code ?? '',
          typePylone: s.typePylone ?? '',
          hasClimatiseur: oui(s.hasClimatiseur),
          hasExtincteurs: oui(s.hasExtincteurs),
          cuveVolumeLitres: s.cuveVolumeLitres != null ? Number(s.cuveVolumeLitres) : '',
          formeCuve: s.formeCuve ?? '',
          cuveDimensions: s.cuveDimensions ?? '',
          puissanceGE2: ge2 ? Number(ge2.puissanceKva) : '',
          statutGE2: ge2?.statut ?? '',
          hasGardien: oui(s.hasGardien),
          gardiennageNuitSeulement: oui(s.gardiennageNuitSeulement),
          societeGardiennage: s.societeGardiennage ?? '',
          telephoneSite: s.telephoneSite ?? '',
          marqueGE: ge1?.marque ?? '',
          marqueGE2: ge2?.marque ?? '',
          nodeId: s.nodeId ?? '',
        };
      }),
    }]);
  } catch (err) { next(err); }
}

/** Planche d'étiquettes QR (site + GE) à imprimer et coller sur place. */
export async function getEtiquettesQr(req: Request, res: Response, next: NextFunction) {
  try {
    const site = await prisma.site.findUnique({
      where: { id: req.params.id },
      select: { id: true, code: true, nom: true, region: true,
        groupes: { where: { isActive: true }, orderBy: { numero: 'asc' }, select: { id: true, numero: true, puissanceKva: true } } },
    });
    if (!site) throw new AppError('Site introuvable', 404);
    await assertSiteInPerimetre(req.user!.id, site.id);
    const pdf = await generateEtiquettesQrPdf({
      site: { id: site.id, code: site.code, nom: site.nom, region: site.region },
      ges: site.groupes.map((g) => ({ id: g.id, numero: g.numero, puissanceKva: Number(g.puissanceKva) })),
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="etiquettes-qr-${site.code}.pdf"`);
    res.send(pdf);
  } catch (err) { next(err); }
}

/**
 * Import de la topologie de transmission depuis un fichier Excel
 * (colonnes : site, parent, type). Rattache chaque site à son amont et pose le
 * type de liaison (FIBER / TN / ML / RTN…). Idempotent : ré-import = mise à jour.
 * Les cycles et les noms introuvables sont ignorés et rapportés, jamais insérés.
 */
export async function importTopologie(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) throw new AppError('Aucun fichier reçu (champ "file").', 400);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.file.buffer as unknown as ArrayBuffer, {
      // Les nœuds de présentation (styles, images, mises en forme) représentent
      // l'essentiel de la mémoire d'un .xlsx : 10 Mo de fichier donnaient
      // 300-600 Mo de heap pour un conteneur limité à 1 Go.
      ignoreNodes: ['dataValidations', 'drawing', 'hyperlinks', 'picture', 'styles', 'conditionalFormatting'],
    });
    const ws = wb.worksheets[0];
    if (!ws || ws.rowCount < 2) throw new AppError('Fichier vide ou sans données.', 400);

    // En-têtes tolérants (ligne 1) : site/enfant, parent/amont, type/liaison.
    let colSite = 0, colParent = 0, colType = 0;
    ws.getRow(1).eachCell((cell, col) => {
      const h = norm(String(cell.value ?? ''));
      if (['site', 'enfant', 'nomsite', 'sitename'].includes(h)) colSite = col;
      else if (['parent', 'amont', 'siteparent', 'parenttransmission'].includes(h)) colParent = col;
      else if (['type', 'liaison', 'typeliaison', 'typedeliaison'].includes(h)) colType = col;
    });
    if (!colSite || !colParent) {
      throw new AppError('Colonnes "site" et "parent" requises (colonne "type" optionnelle).', 422);
    }

    const sites = await prisma.site.findMany({
      where: { isActive: true },
      select: { id: true, nom: true, parentTransmissionId: true },
    });
    const parNom = new Map(sites.map((s) => [norm(s.nom), s]));
    // Graphe en mémoire : détection de cycles au fil de l'application des lignes
    // (un aller-retour base par ligne serait inutilement coûteux sur 800 liaisons).
    const parentDe = new Map<string, string | null>(sites.map((s) => [s.id, s.parentTransmissionId]));
    const creeCycle = (enfantId: string, parentId: string): boolean => {
      let cur: string | null = parentId;
      for (let i = 0; i < 200 && cur; i++) {
        if (cur === enfantId) return true;
        cur = parentDe.get(cur) ?? null;
      }
      return false;
    };

    const texte = (row: ExcelJS.Row, col: number): string => {
      const v = row.getCell(col).value as unknown;
      const brut = v && typeof v === 'object' && 'result' in (v as Record<string, unknown>)
        ? (v as { result: unknown }).result : v;
      return String(brut ?? '').trim();
    };
    // Vocabulaire NOC toléré : « RTN HUAWEI » → RTN, « FIBRE/FIBER » → FIBER…
    const normaliseType = (t: string): string | null => {
      const u = t.toUpperCase().replace(/\s+/g, ' ').trim();
      if (!u) return null;
      if (u.startsWith('RTN')) return 'RTN';
      if (u.startsWith('FIB')) return 'FIBER';
      if (u === 'ML' || u.includes('MICROWAVE')) return 'ML';
      if (u.startsWith('TN')) return 'TN';
      return u;
    };

    const sitesIntrouvables: string[] = [];
    const parentsIntrouvables: string[] = [];
    const cyclesIgnores: string[] = [];
    let lignesIncompletes = 0;
    const maj: { id: string; parentId: string; type: string | null }[] = [];

    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const nomSite = texte(row, colSite);
      const nomParent = texte(row, colParent);
      if (!nomSite && !nomParent) continue;
      if (!nomSite || !nomParent) { lignesIncompletes++; continue; }
      const enfant = parNom.get(norm(nomSite));
      if (!enfant) { sitesIntrouvables.push(nomSite); continue; }
      const parent = parNom.get(norm(nomParent));
      if (!parent) { parentsIntrouvables.push(nomParent); continue; }
      if (enfant.id === parent.id || creeCycle(enfant.id, parent.id)) { cyclesIgnores.push(nomSite); continue; }
      parentDe.set(enfant.id, parent.id);
      maj.push({ id: enfant.id, parentId: parent.id, type: colType ? normaliseType(texte(row, colType)) : null });
    }

    // Écritures par lots courts — idempotent, aucune suppression.
    for (let i = 0; i < maj.length; i += 100) {
      await prisma.$transaction(
        maj.slice(i, i + 100).map((m) =>
          prisma.site.update({
            where: { id: m.id },
            data: { parentTransmissionId: m.parentId, ...(m.type ? { typeLiaison: m.type } : {}) },
          })
        )
      );
    }

    await cacheService.invalidate('sites:geojson*');
    await auditLog(req.user!.id, 'UPDATE', 'sites', undefined, {
      topologie: { liaisons: maj.length, sitesIntrouvables: sitesIntrouvables.length, parentsIntrouvables: parentsIntrouvables.length },
    }, req);

    res.json({
      success: true,
      data: {
        liaisons: maj.length,
        sitesIntrouvables: [...new Set(sitesIntrouvables)],
        parentsIntrouvables: [...new Set(parentsIntrouvables)],
        lignesIncompletes,
        cyclesIgnores,
      },
    });
  } catch (err) { next(err); }
}

/**
 * Export de la topologie de transmission : une ligne par liaison site → parent.
 * L'xlsx garde les colonnes site/parent/type de l'import — le fichier exporté
 * est donc directement ré-importable ; le PDF est le même tableau mis en page.
 */
export async function exportTopologie(req: Request, res: Response, next: NextFunction) {
  try {
    const sites = await prisma.site.findMany({
      where: { isActive: true },
      take: EXPORT_MAX,
      select: {
        id: true, nom: true, region: true, typeLiaison: true, parentTransmissionId: true,
        parentTransmission: { select: { nom: true } },
      },
      orderBy: { nom: 'asc' },
    });
    // Nombre de sites directement en aval de chaque site (poids de la liaison).
    const nbAval = new Map<string, number>();
    for (const s of sites) {
      if (s.parentTransmissionId) nbAval.set(s.parentTransmissionId, (nbAval.get(s.parentTransmissionId) ?? 0) + 1);
    }
    const ref = new Map(typesLiaison().map((t) => [t.code, t]));
    const rows = sites
      .filter((s) => s.parentTransmission)
      .map((s) => ({
        site: s.nom,
        parent: s.parentTransmission!.nom,
        type: s.typeLiaison ?? '',
        famille: (s.typeLiaison && ref.get(s.typeLiaison)?.famille) || '',
        constructeur: (s.typeLiaison && ref.get(s.typeLiaison)?.constructeur) || '',
        region: s.region,
        sitesAval: nbAval.get(s.id) ?? 0,
      }));

    await auditLog(req.user!.id, 'EXPORT', 'sites', undefined, { topologie: rows.length }, req);
    await sendTabular(res, req.params.format, 'topologie', 'Topologie de transmission', [{
      name: 'Topologie',
      columns: [
        { header: 'site', key: 'site', width: 26 },
        { header: 'parent', key: 'parent', width: 26 },
        { header: 'type', key: 'type', width: 10 },
        { header: 'famille', key: 'famille', width: 10 },
        { header: 'constructeur', key: 'constructeur', width: 14 },
        { header: 'region', key: 'region', width: 18 },
        { header: 'sitesAval', key: 'sitesAval', width: 10 },
      ],
      rows,
    }], `${rows.length} liaison(s) déclarée(s)`);
  } catch (err) { next(err); }
}
