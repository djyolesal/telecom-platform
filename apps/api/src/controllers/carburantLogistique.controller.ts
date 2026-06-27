import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { paginate } from '../utils/paginator';
import { auditLog } from '../services/audit.service';

// Tolérance d'arrondi (litres) pour le contrôle « Σ lignes = volume chargé ».
const TOLERANCE_L = 0.5;

const n = (v: unknown): number => (v == null ? 0 : Number(v));

/** Normalise et valide les volumes mensuels d'un bon de commande. */
function parseVolumes(raw: unknown): { mois: number; volumePrevuLitres: number }[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: { mois: number; volumePrevuLitres: number }[] = [];
  const seen = new Set<number>();
  for (const v of arr) {
    const mois = Math.trunc(n((v as any).mois));
    const vol = n((v as any).volumePrevuLitres);
    if (mois < 1 || mois > 12) throw new AppError(`Mois invalide : ${mois}`, 400);
    if (seen.has(mois)) throw new AppError(`Mois ${mois} en double dans le bon de commande`, 400);
    seen.add(mois);
    out.push({ mois, volumePrevuLitres: vol });
  }
  return out;
}

/** Normalise et valide les lignes du plan de livraison. */
function parseLignes(raw: unknown): { siteId: string; volumePrevuLitres: number }[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: { siteId: string; volumePrevuLitres: number }[] = [];
  const seen = new Set<string>();
  for (const l of arr) {
    const siteId = String((l as any).siteId ?? '').trim();
    const vol = n((l as any).volumePrevuLitres);
    if (!siteId) throw new AppError('Ligne de plan sans site', 400);
    if (seen.has(siteId)) throw new AppError('Un même site apparaît deux fois dans le plan', 400);
    seen.add(siteId);
    if (vol <= 0) throw new AppError('Volume prévu d\'une ligne doit être > 0', 400);
    out.push({ siteId, volumePrevuLitres: vol });
  }
  return out;
}

// ── BONS DE COMMANDE ──────────────────────────────────────────

export async function getBonsCommande(req: Request, res: Response, next: NextFunction) {
  try {
    const { annee, trimestre, statut, page = '1', limit = '20' } = req.query as Record<string, string>;
    const where: Prisma.BonCommandeWhereInput = {};
    if (annee) where.annee = parseInt(annee);
    if (trimestre) where.trimestre = parseInt(trimestre);
    if (statut) where.statut = statut as any;

    const { data, meta } = await paginate(
      prisma.bonCommande,
      {
        where,
        orderBy: [{ annee: 'desc' }, { trimestre: 'desc' }],
        include: {
          volumesMensuels: { orderBy: { mois: 'asc' } },
          _count: { select: { bonsLivraison: true } },
        },
      },
      { page: parseInt(page), limit: parseInt(limit) }
    );
    res.json({ success: true, data, meta });
  } catch (err) { next(err); }
}

export async function getBonCommandeById(req: Request, res: Response, next: NextFunction) {
  try {
    const bc = await prisma.bonCommande.findUnique({
      where: { id: req.params.id },
      include: {
        volumesMensuels: { orderBy: { mois: 'asc' } },
        bonsLivraison: {
          orderBy: [{ annee: 'asc' }, { mois: 'asc' }, { dateChargement: 'asc' }],
          include: { _count: { select: { lignes: true } } },
        },
      },
    });
    if (!bc) throw new AppError('Bon de commande introuvable', 404);

    // Suivi commandé vs livré, par mois.
    const charge = new Map<number, number>();
    for (const bl of bc.bonsLivraison) {
      if (bl.statut === 'ANNULE') continue;
      charge.set(bl.mois, (charge.get(bl.mois) ?? 0) + n(bl.volumeChargeLitres));
    }
    const suivi = bc.volumesMensuels.map((vm) => {
      const livre = charge.get(vm.mois) ?? 0;
      const prevu = n(vm.volumePrevuLitres);
      return { mois: vm.mois, prevu, livre, ecart: livre - prevu, depassement: livre > prevu + TOLERANCE_L };
    });

    res.json({ success: true, data: { ...bc, suivi } });
  } catch (err) { next(err); }
}

export async function createBonCommande(req: Request, res: Response, next: NextFunction) {
  try {
    const { numero, annee, trimestre, numeroClient, observations, statut } = req.body;
    if (!numero) throw new AppError('Numéro de bon de commande requis', 400);
    if (!numeroClient) throw new AppError('Numéro client requis', 400);
    const t = Math.trunc(n(trimestre));
    if (t < 1 || t > 4) throw new AppError('Trimestre invalide (1..4)', 400);
    const volumes = parseVolumes(req.body.volumesMensuels);

    const bc = await prisma.bonCommande.create({
      data: {
        numero: String(numero).trim(),
        annee: Math.trunc(n(annee)),
        trimestre: t,
        numeroClient: String(numeroClient).trim(),
        statut: statut ?? undefined,
        observations: observations ?? null,
        volumesMensuels: { create: volumes },
      },
      include: { volumesMensuels: { orderBy: { mois: 'asc' } } },
    });
    await auditLog(req.user!.id, 'CREATE', 'bons_commande', bc.id, req.body, req);
    res.status(201).json({ success: true, data: bc });
  } catch (err) { next(mapKnownError(err, 'Un bon de commande avec ce numéro existe déjà')); }
}

export async function updateBonCommande(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.bonCommande.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Bon de commande introuvable', 404);
    const { numero, annee, trimestre, numeroClient, observations, statut } = req.body;

    const data: Prisma.BonCommandeUpdateInput = {};
    if (numero != null) data.numero = String(numero).trim();
    if (annee != null) data.annee = Math.trunc(n(annee));
    if (trimestre != null) {
      const t = Math.trunc(n(trimestre));
      if (t < 1 || t > 4) throw new AppError('Trimestre invalide (1..4)', 400);
      data.trimestre = t;
    }
    if (numeroClient != null) data.numeroClient = String(numeroClient).trim();
    if (observations !== undefined) data.observations = observations;
    if (statut != null) data.statut = statut;

    // Remplacement complet des volumes mensuels si fournis.
    if (req.body.volumesMensuels !== undefined) {
      const volumes = parseVolumes(req.body.volumesMensuels);
      await prisma.volumeMensuel.deleteMany({ where: { bonCommandeId: existing.id } });
      data.volumesMensuels = { create: volumes };
    }

    const bc = await prisma.bonCommande.update({
      where: { id: existing.id },
      data,
      include: { volumesMensuels: { orderBy: { mois: 'asc' } } },
    });
    await auditLog(req.user!.id, 'UPDATE', 'bons_commande', bc.id, req.body, req);
    res.json({ success: true, data: bc });
  } catch (err) { next(mapKnownError(err, 'Un bon de commande avec ce numéro existe déjà')); }
}

export async function deleteBonCommande(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.bonCommande.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { bonsLivraison: true } } },
    });
    if (!existing) throw new AppError('Bon de commande introuvable', 404);
    if (existing._count.bonsLivraison > 0)
      throw new AppError('Impossible de supprimer : des bons de livraison y sont rattachés', 409);
    await prisma.bonCommande.delete({ where: { id: existing.id } });
    await auditLog(req.user!.id, 'DELETE', 'bons_commande', existing.id, {}, req);
    res.json({ success: true, message: 'Bon de commande supprimé' });
  } catch (err) { next(err); }
}

// ── BONS DE LIVRAISON (chargements camion + plan de livraison) ──

export async function getBonsLivraison(req: Request, res: Response, next: NextFunction) {
  try {
    const { bon_commande_id, mois, annee, statut, page = '1', limit = '20' } =
      req.query as Record<string, string>;
    const where: Prisma.BonLivraisonWhereInput = {};
    if (bon_commande_id) where.bonCommandeId = bon_commande_id;
    if (mois) where.mois = parseInt(mois);
    if (annee) where.annee = parseInt(annee);
    if (statut) where.statut = statut as any;

    const { data, meta } = await paginate(
      prisma.bonLivraison,
      {
        where,
        orderBy: { dateChargement: 'desc' },
        include: {
          bonCommande: { select: { numero: true } },
          _count: { select: { lignes: true } },
        },
      },
      { page: parseInt(page), limit: parseInt(limit) }
    );
    res.json({ success: true, data, meta });
  } catch (err) { next(err); }
}

export async function getBonLivraisonById(req: Request, res: Response, next: NextFunction) {
  try {
    const bl = await prisma.bonLivraison.findUnique({
      where: { id: req.params.id },
      include: {
        bonCommande: { select: { numero: true, annee: true, trimestre: true } },
        lignes: {
          orderBy: { createdAt: 'asc' },
          include: {
            site: { select: { code: true, nom: true, region: true } },
            depotages: { select: { id: true, dateDepotage: true, volumeLitres: true } },
          },
        },
      },
    });
    if (!bl) throw new AppError('Bon de livraison introuvable', 404);

    // Écart prévu (plan) vs livré (dépotages réels) par ligne.
    const lignes = bl.lignes.map((l) => {
      const livre = l.depotages.reduce((s, d) => s + n(d.volumeLitres), 0);
      const prevu = n(l.volumePrevuLitres);
      return { ...l, volumeLivreReel: livre, ecart: livre - prevu };
    });
    const sommeLignes = lignes.reduce((s, l) => s + n(l.volumePrevuLitres), 0);

    res.json({
      success: true,
      data: {
        ...bl,
        lignes,
        sommeLignes,
        coherenceCharge: Math.abs(sommeLignes - n(bl.volumeChargeLitres)) <= TOLERANCE_L,
      },
    });
  } catch (err) { next(err); }
}

/** Valide le plan : Σ lignes = volume chargé, et alerte si dépassement mensuel du BC. */
async function validatePlan(
  bonCommandeId: string,
  mois: number,
  volumeCharge: number,
  lignes: { volumePrevuLitres: number }[],
  ignoreBlId?: string
): Promise<{ warnings: string[] }> {
  const sommeLignes = lignes.reduce((s, l) => s + l.volumePrevuLitres, 0);
  if (lignes.length > 0 && Math.abs(sommeLignes - volumeCharge) > TOLERANCE_L) {
    throw new AppError(
      `Le total du plan (${sommeLignes} L) doit être égal au volume chargé du camion (${volumeCharge} L).`,
      400
    );
  }
  const warnings: string[] = [];
  // Contrôle « respect du volume mensuel du BC ».
  const vm = await prisma.volumeMensuel.findUnique({
    where: { bonCommandeId_mois: { bonCommandeId, mois } },
  });
  if (!vm) {
    warnings.push(`Aucun volume prévu pour le mois ${mois} dans ce bon de commande.`);
  } else {
    const autres = await prisma.bonLivraison.aggregate({
      _sum: { volumeChargeLitres: true },
      where: {
        bonCommandeId,
        mois,
        statut: { not: 'ANNULE' },
        ...(ignoreBlId ? { id: { not: ignoreBlId } } : {}),
      },
    });
    const cumul = n(autres._sum.volumeChargeLitres) + volumeCharge;
    if (cumul > n(vm.volumePrevuLitres) + TOLERANCE_L) {
      warnings.push(
        `Dépassement du volume mensuel : ${cumul} L chargés pour le mois ${mois} contre ${n(vm.volumePrevuLitres)} L prévus au bon de commande.`
      );
    }
  }
  return { warnings };
}

export async function createBonLivraison(req: Request, res: Response, next: NextFunction) {
  try {
    const { bonCommandeId, numeroBL, mois, annee, immatriculation, volumeChargeLitres, dateChargement, dateTraitement, observations, statut } = req.body;
    if (!bonCommandeId) throw new AppError('Bon de commande requis', 400);
    if (!numeroBL) throw new AppError('Numéro de bon de livraison requis', 400);
    if (!immatriculation) throw new AppError('Immatriculation du camion requise', 400);

    const bc = await prisma.bonCommande.findUnique({ where: { id: bonCommandeId } });
    if (!bc) throw new AppError('Bon de commande introuvable', 404);

    const m = Math.trunc(n(mois));
    if (m < 1 || m > 12) throw new AppError('Mois invalide (1..12)', 400);
    const volume = n(volumeChargeLitres);
    if (volume <= 0) throw new AppError('Volume chargé doit être > 0', 400);
    const lignes = parseLignes(req.body.lignes);

    const { warnings } = await validatePlan(bonCommandeId, m, volume, lignes);

    const bl = await prisma.bonLivraison.create({
      data: {
        bonCommandeId,
        numeroBL: String(numeroBL).trim(),
        mois: m,
        annee: Math.trunc(n(annee)) || bc.annee,
        immatriculation: String(immatriculation).trim(),
        volumeChargeLitres: volume,
        numeroClient: bc.numeroClient, // constant, hérité du BC
        dateChargement: dateChargement ? new Date(dateChargement) : new Date(),
        dateTraitement: dateTraitement ? new Date(dateTraitement) : null,
        statut: statut ?? undefined,
        observations: observations ?? null,
        lignes: { create: lignes },
      },
      include: { lignes: { include: { site: { select: { code: true, nom: true } } } } },
    });
    await auditLog(req.user!.id, 'CREATE', 'bons_livraison', bl.id, req.body, req);
    res.status(201).json({ success: true, data: bl, warnings });
  } catch (err) { next(mapKnownError(err, 'Un bon de livraison avec ce numéro existe déjà')); }
}

export async function updateBonLivraison(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.bonLivraison.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Bon de livraison introuvable', 404);
    const { numeroBL, mois, annee, immatriculation, volumeChargeLitres, dateChargement, dateTraitement, observations, statut } = req.body;

    const data: Prisma.BonLivraisonUpdateInput = {};
    if (numeroBL != null) data.numeroBL = String(numeroBL).trim();
    if (mois != null) {
      const m = Math.trunc(n(mois));
      if (m < 1 || m > 12) throw new AppError('Mois invalide (1..12)', 400);
      data.mois = m;
    }
    if (annee != null) data.annee = Math.trunc(n(annee));
    if (immatriculation != null) data.immatriculation = String(immatriculation).trim();
    if (volumeChargeLitres != null) data.volumeChargeLitres = n(volumeChargeLitres);
    if (dateChargement != null) data.dateChargement = new Date(dateChargement);
    if (dateTraitement !== undefined) data.dateTraitement = dateTraitement ? new Date(dateTraitement) : null;
    if (observations !== undefined) data.observations = observations;
    if (statut != null) data.statut = statut;

    let warnings: string[] = [];
    const effMois = data.mois != null ? (data.mois as number) : existing.mois;
    const effVolume = data.volumeChargeLitres != null ? (data.volumeChargeLitres as number) : n(existing.volumeChargeLitres);

    if (req.body.lignes !== undefined) {
      const lignes = parseLignes(req.body.lignes);
      ({ warnings } = await validatePlan(existing.bonCommandeId, effMois, effVolume, lignes, existing.id));
      await prisma.ligneLivraison.deleteMany({ where: { bonLivraisonId: existing.id } });
      data.lignes = { create: lignes };
    } else if (data.mois != null || data.volumeChargeLitres != null) {
      // Volume/mois changé sans toucher aux lignes : re-vérifie cohérence sur les lignes existantes.
      const lignes = await prisma.ligneLivraison.findMany({ where: { bonLivraisonId: existing.id } });
      ({ warnings } = await validatePlan(
        existing.bonCommandeId, effMois, effVolume,
        lignes.map((l) => ({ volumePrevuLitres: n(l.volumePrevuLitres) })), existing.id
      ));
    }

    const bl = await prisma.bonLivraison.update({
      where: { id: existing.id },
      data,
      include: { lignes: { include: { site: { select: { code: true, nom: true } } } } },
    });
    await auditLog(req.user!.id, 'UPDATE', 'bons_livraison', bl.id, req.body, req);
    res.json({ success: true, data: bl, warnings });
  } catch (err) { next(mapKnownError(err, 'Un bon de livraison avec ce numéro existe déjà')); }
}

export async function deleteBonLivraison(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.bonLivraison.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Bon de livraison introuvable', 404);
    await prisma.bonLivraison.delete({ where: { id: existing.id } });
    await auditLog(req.user!.id, 'DELETE', 'bons_livraison', existing.id, {}, req);
    res.json({ success: true, message: 'Bon de livraison supprimé' });
  } catch (err) { next(err); }
}

/** Lignes de plan de livraison ouvertes pour un site (consommé par le mobile au dépotage). */
export async function getLignesLivraisonForSite(req: Request, res: Response, next: NextFunction) {
  try {
    const lignes = await prisma.ligneLivraison.findMany({
      where: {
        siteId: req.params.id,
        statut: { in: ['PREVU', 'PARTIEL'] },
        bonLivraison: { statut: { not: 'ANNULE' } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        bonLivraison: { select: { numeroBL: true, immatriculation: true, dateChargement: true } },
      },
    });
    res.json({ success: true, data: lignes });
  } catch (err) { next(err); }
}

/** Traduit les erreurs Prisma connues (contrainte d'unicité) en AppError lisible. */
function mapKnownError(err: unknown, uniqueMsg: string): unknown {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    return new AppError(uniqueMsg, 409);
  }
  return err;
}
