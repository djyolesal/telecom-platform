import { publicFileUrl, uploadBuffer } from '../services/storage.service';
import { analyserBonCommandePdf as analyserBcPdf } from '../services/bcPdf.service';
import { analyserBonLivraisonDocument as analyserBlDoc } from '../services/blPdf.service';
import { Request, Response, NextFunction } from 'express';
import { assertSiteInPerimetre } from '../utils/perimetre';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { paginate } from '../utils/paginator';
import { auditLog } from '../services/audit.service';
import { buildXlsx, setXlsxHeaders } from '../utils/excel';
import { sendTabular } from '../utils/exporter';
import { generatePlanLivraisonPdf } from '../services/pdf.service';
import { computeManquants } from '../services/manquants.service';
import { forecastSites, suggestTournees } from '../services/replenishment.service';
import { detectAnomalies, generateSynthese } from '../services/intelligence.service';
import { getNum } from '../services/settings.service';
import { clearMemo } from '../utils/memo';
import { env } from '../config/env';

const MOIS = ['', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

/** Prestataire (transporteur) rattaché à l'utilisateur courant, le cas échéant. */
async function userPrestataireId(userId: string): Promise<string | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { prestataireId: true } });
  return u?.prestataireId ?? null;
}

/**
 * Cloisonnement transporteur : un TRANSPORTEUR n'accède qu'aux BL de SON prestataire.
 * Refuse aussi le transporteur sans prestataire et les BL non affectés (évite le piège null === null).
 */
async function assertTransporteurAccess(req: Request, transporteurId: string | null): Promise<void> {
  if (req.user!.role !== 'TRANSPORTEUR') return;
  const pid = await userPrestataireId(req.user!.id);
  if (!pid || transporteurId !== pid) throw new AppError('Accès refusé à ce bon de livraison', 403);
}

// Tolérance d'arrondi (litres) pour le contrôle « Σ lignes = volume chargé ».
const TOLERANCE_L = 0.5;
const MAX_LITRES = 10_000_000; // borne de sûreté (anti-pollution d'agrégats / overflow numeric)

// Number sûr : rejette NaN/Infinity (qui sinon franchissent les tests `<= 0`).
const n = (v: unknown): number => { const x = v == null ? 0 : Number(v); return Number.isFinite(x) ? x : 0; };

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
    if (vol < 0 || vol > MAX_LITRES) throw new AppError('Volume mensuel hors limites', 400);
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
    if (vol <= 0 || vol > MAX_LITRES) throw new AppError('Volume prévu d\'une ligne hors limites (> 0)', 400);
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
    // Un transporteur ne doit voir QUE ses propres chargements : le détail du BC
    // exposait les BL de tous les transporteurs (camions, volumes, statuts).
    if (req.user!.role === 'TRANSPORTEUR') {
      const moi = await userPrestataireId(req.user!.id);
      bc.bonsLivraison = bc.bonsLivraison.filter((bl) => bl.transporteurId === moi);
    }

    // Suivi commandé vs livré, par mois.
    const charge = new Map<number, number>();
    for (const bl of bc.bonsLivraison) {
      if (bl.statut === 'ANNULE' || bl.isBrouillon) continue; // brouillon = pas un chargement réel
      charge.set(bl.mois, (charge.get(bl.mois) ?? 0) + n(bl.volumeChargeLitres));
    }
    const suivi = bc.volumesMensuels.map((vm) => {
      const livre = charge.get(vm.mois) ?? 0;
      const prevu = n(vm.volumePrevuLitres);
      return { mois: vm.mois, prevu, livre, ecart: livre - prevu, depassement: livre > prevu + TOLERANCE_L };
    });

    // URL signée : le bucket n'est plus lisible publiquement par son chemin.
    res.json({ success: true, data: { ...bc, suivi, bcPdfUrl: bc.bcPdfPath ? publicFileUrl(bc.bcPdfPath) : null } });
  } catch (err) { next(err); }
}

/**
 * Analyse le PDF d'un bon de commande (natif ou scan → OCR) et renvoie les
 * champs extraits pour PRÉ-REMPLIR le formulaire, plus la clé MinIO du PDF
 * déjà archivé — l'utilisateur relit, corrige au besoin, puis crée le BC.
 */
export async function analyserBonCommandePdf(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) throw new AppError('Fichier PDF requis', 400);
    if (req.file.mimetype !== 'application/pdf') throw new AppError('Seul un PDF est accepté ici', 415);

    const extraction = await analyserBcPdf(req.file.buffer);
    // Le PDF est archivé immédiatement : le formulaire recevra la clé et la
    // création du BC pointera sur ce document, sans second upload.
    const stocke = await uploadBuffer(req.file.buffer, req.file.originalname, 'application/pdf', 'bons-commande');

    await auditLog(req.user!.id, 'CREATE', 'bons_commande', undefined, {
      analysePdf: true, numero: extraction.numero, ocr: extraction.ocr, avertissements: extraction.avertissements.length,
    }, req);
    res.json({ success: true, data: { ...extraction, bcPdfPath: stocke.key } });
  } catch (err) { next(err); }
}

export async function createBonCommande(req: Request, res: Response, next: NextFunction) {
  try {
    const { numero, annee, trimestre, numeroClient, observations, statut, bcPdfPath } = req.body;
    if (!numero) throw new AppError('Numéro de bon de commande requis', 400);
    // numeroClient : rien de tel sur le BC Moov réel (centre de coût, compte
    // fournisseur, DA…) — champ facultatif, conservé pour les BC qui en ont un.
    const t = Math.trunc(n(trimestre));
    if (t < 1 || t > 4) throw new AppError('Trimestre invalide (1..4)', 400);
    const volumes = parseVolumes(req.body.volumesMensuels);

    const bc = await prisma.bonCommande.create({
      data: {
        numero: String(numero).trim(),
        annee: Math.trunc(n(annee)),
        trimestre: t,
        numeroClient: numeroClient ? String(numeroClient).trim() : null,
        statut: statut ?? undefined,
        bcPdfPath: bcPdfPath ?? null,
        observations: observations ?? null,
        volumesMensuels: { create: volumes },
      },
      include: { volumesMensuels: { orderBy: { mois: 'asc' } } },
    });
    await auditLog(req.user!.id, 'CREATE', 'bons_commande', bc.id, req.body, req);
    clearMemo();
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
    clearMemo();
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
    clearMemo();
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
    // Un transporteur ne voit que ses propres bons de livraison.
    if (req.user!.role === 'TRANSPORTEUR') {
      where.transporteurId = (await userPrestataireId(req.user!.id)) ?? '__none__';
    }

    const { data, meta } = await paginate(
      prisma.bonLivraison,
      {
        where,
        orderBy: { dateChargement: 'desc' },
        include: {
          bonCommande: { select: { numero: true } },
          transporteur: { select: { nom: true } },
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
        transporteur: { select: { id: true, nom: true } },
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
    await assertTransporteurAccess(req, bl.transporteurId);

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
        blPdfUrl: bl.blPdfPath ? publicFileUrl(bl.blPdfPath) : null,
        bordereauPdfUrl: bl.bordereauPdfPath ? publicFileUrl(bl.bordereauPdfPath) : null,
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
        isBrouillon: false, // un brouillon n'est pas un chargement réel
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

/**
 * Analyse un document de bon de livraison — PDF (web, possiblement plusieurs BL,
 * un par page) ou photo du transporteur (mobile) — et renvoie les champs par BL
 * reconnu, plus les BC correspondants trouvés en base et la clé du document
 * archivé. Le formulaire est pré-rempli, l'utilisateur relit et valide.
 */
export async function analyserBonLivraisonDocument(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) throw new AppError('Fichier PDF ou photo requis', 400);

    const { documents, ocrUtilise, pagesIgnorees } = await analyserBlDoc(req.file.buffer, req.file.mimetype);

    // Rattachement aux BC : le document porte « BC N°POxxxxxxxxx ».
    const numerosBc = [...new Set(documents.map((d) => d.bcNumero).filter((x): x is string => !!x))];
    const bcs = numerosBc.length
      ? await prisma.bonCommande.findMany({
          where: { numero: { in: numerosBc } },
          select: { id: true, numero: true, annee: true, trimestre: true, volumesMensuels: { select: { mois: true }, orderBy: { mois: 'asc' } } },
        })
      : [];
    const bcParNumero = Object.fromEntries(bcs.map((b) => [b.numero, { id: b.id, numero: b.numero, annee: b.annee, trimestre: b.trimestre, mois: b.volumesMensuels.map((v) => v.mois) }]));
    for (const d of documents) {
      if (d.bcNumero && !bcParNumero[d.bcNumero]) {
        d.avertissements.push(`Le bon de commande ${d.bcNumero} n'existe pas encore dans la plateforme — créez-le d'abord.`);
      }
    }

    // Archivage du document : réutilisé comme pièce jointe du BL (PDF) ou trace (photo).
    const stocke = await uploadBuffer(req.file.buffer, req.file.originalname, req.file.mimetype, 'bons-livraison');

    await auditLog(req.user!.id, 'CREATE', 'bons_livraison', undefined, {
      analyseDocument: true, documents: documents.length, ocr: ocrUtilise, pagesIgnorees,
    }, req);
    res.json({ success: true, data: { documents, bcs: bcParNumero, documentPath: stocke.key, ocr: ocrUtilise, pagesIgnorees } });
  } catch (err) { next(err); }
}

export async function createBonLivraison(req: Request, res: Response, next: NextFunction) {
  try {
    const { bonCommandeId, numeroBL, mois, annee, immatriculation, volumeChargeLitres, dateChargement, dateTraitement, observations, statut, blPdfPath, bordereauPdfPath } = req.body;
    if (!bonCommandeId) throw new AppError('Bon de commande requis', 400);
    if (!numeroBL) throw new AppError('Numéro de bon de livraison requis', 400);
    if (!immatriculation) throw new AppError('Immatriculation du camion requise', 400);

    const bc = await prisma.bonCommande.findUnique({ where: { id: bonCommandeId } });
    if (!bc) throw new AppError('Bon de commande introuvable', 404);

    // Transporteur : rattaché à son propre prestataire. Manager : peut désigner le transporteur.
    let transporteurId: string | null;
    if (req.user!.role === 'TRANSPORTEUR') {
      transporteurId = await userPrestataireId(req.user!.id);
      if (!transporteurId) throw new AppError('Votre compte n\'est rattaché à aucun transporteur', 403);
    } else {
      transporteurId = req.body.transporteurId ?? null;
    }

    const m = Math.trunc(n(mois));
    if (m < 1 || m > 12) throw new AppError('Mois invalide (1..12)', 400);
    const volume = n(volumeChargeLitres);
    if (volume <= 0) throw new AppError('Volume chargé doit être > 0', 400);
    // Le plan est optionnel à la création (le manager le génère/édite ensuite).
    // Le TRANSPORTEUR ne peut pas le poser — même règle qu'à la modification
    // (sinon il s'auto-affectait des sites qu'il ne dessert pas).
    const estTransporteur = req.user!.role === 'TRANSPORTEUR';
    const lignes = estTransporteur ? [] : parseLignes(req.body.lignes);
    const { warnings } = await validatePlan(bonCommandeId, m, volume, lignes);

    const bl = await prisma.bonLivraison.create({
      data: {
        bonCommandeId,
        transporteurId,
        numeroBL: String(numeroBL).trim(),
        mois: m,
        annee: Math.trunc(n(annee)) || bc.annee,
        immatriculation: String(immatriculation).trim(),
        volumeChargeLitres: volume,
        numeroClient: bc.numeroClient, // constant, hérité du BC
        dateChargement: dateChargement ? new Date(dateChargement) : new Date(),
        dateTraitement: dateTraitement ? new Date(dateTraitement) : null,
        statut: statut ?? undefined,
        blPdfPath: blPdfPath ?? null,
        bordereauPdfPath: bordereauPdfPath ?? null,
        observations: observations ?? null,
        ...(lignes.length ? { lignes: { create: lignes } } : {}),
      },
      include: { lignes: { include: { site: { select: { code: true, nom: true } } } } },
    });
    await auditLog(req.user!.id, 'CREATE', 'bons_livraison', bl.id, req.body, req);
    clearMemo();
    res.status(201).json({ success: true, data: bl, warnings });
  } catch (err) { next(mapKnownError(err, 'Un bon de livraison avec ce numéro existe déjà')); }
}

export async function updateBonLivraison(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.bonLivraison.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Bon de livraison introuvable', 404);
    // Un transporteur ne peut éditer que ses propres BL (et pas le plan, ni finaliser un brouillon).
    const isTransporteur = req.user!.role === 'TRANSPORTEUR';
    await assertTransporteurAccess(req, existing.transporteurId);
    const { numeroBL, mois, annee, immatriculation, volumeChargeLitres, dateChargement, dateTraitement, observations, statut, blPdfPath, bordereauPdfPath, transporteurId } = req.body;

    const data: Prisma.BonLivraisonUpdateInput = {};
    if (numeroBL != null) {
      data.numeroBL = String(numeroBL).trim();
      // La finalisation d'un brouillon (vrai numéro) est réservée au manager/admin.
      if (!String(numeroBL).trim().startsWith('BR-') && !isTransporteur) data.isBrouillon = false;
    }
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
    if (blPdfPath !== undefined) data.blPdfPath = blPdfPath;
    if (bordereauPdfPath !== undefined) data.bordereauPdfPath = bordereauPdfPath;
    if (transporteurId !== undefined && !isTransporteur) {
      data.transporteur = transporteurId ? { connect: { id: transporteurId } } : { disconnect: true };
    }

    let warnings: string[] = [];
    const effMois = data.mois != null ? (data.mois as number) : existing.mois;
    const effVolume = data.volumeChargeLitres != null ? (data.volumeChargeLitres as number) : n(existing.volumeChargeLitres);

    let nouvellesLignes: { siteId: string; volumePrevuLitres: number }[] | null = null;
    if (req.body.lignes !== undefined && !isTransporteur) {
      nouvellesLignes = parseLignes(req.body.lignes);
      ({ warnings } = await validatePlan(existing.bonCommandeId, effMois, effVolume, nouvellesLignes, existing.id));
      // Les lignes sont remplacées en préservant les dépotages (hors bloc update ci-dessous).
    } else if (data.mois != null || data.volumeChargeLitres != null) {
      // Volume/mois changé sans toucher aux lignes : re-vérifie cohérence sur les lignes existantes.
      const lignes = await prisma.ligneLivraison.findMany({ where: { bonLivraisonId: existing.id } });
      ({ warnings } = await validatePlan(
        existing.bonCommandeId, effMois, effVolume,
        lignes.map((l) => ({ volumePrevuLitres: n(l.volumePrevuLitres) })), existing.id
      ));
    }

    const bl = await prisma.$transaction(async (tx) => {
      if (nouvellesLignes) {
        const preserveWarn = await replaceLignesPreservees(tx, existing.id, nouvellesLignes);
        warnings = [...warnings, ...preserveWarn];
      }
      return tx.bonLivraison.update({
        where: { id: existing.id },
        data,
        include: { lignes: { include: { site: { select: { code: true, nom: true } } } } },
      });
    });
    await auditLog(req.user!.id, 'UPDATE', 'bons_livraison', bl.id, { updated: Object.keys(data) }, req);
    clearMemo();
    res.json({ success: true, data: bl, warnings });
  } catch (err) { next(mapKnownError(err, 'Un bon de livraison avec ce numéro existe déjà')); }
}

export async function deleteBonLivraison(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.bonLivraison.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Bon de livraison introuvable', 404);
    // Refus si des dépotages réels sont rattachés à ce BL : la cascade détacherait
    // les livraisons (ligneLivraisonId → NULL) et fausserait manquants/stocks.
    const depotagesLies = await prisma.depotage.count({ where: { ligneLivraison: { bonLivraisonId: existing.id } } });
    if (depotagesLies > 0) {
      throw new AppError(`Suppression refusée : ${depotagesLies} dépotage(s) sont rattachés à ce bon de livraison.`, 409);
    }
    await prisma.bonLivraison.delete({ where: { id: existing.id } });
    await auditLog(req.user!.id, 'DELETE', 'bons_livraison', existing.id, {}, req);
    clearMemo();
    res.json({ success: true, message: 'Bon de livraison supprimé' });
  } catch (err) { next(err); }
}

/**
 * Remplace les lignes d'un plan SANS détruire les livraisons réelles.
 * - upsert par (bonLivraison, site) : préserve la ligne et ses dépotages rattachés ;
 * - une ligne retirée du plan n'est supprimée QUE si aucun dépotage n'y est
 *   rattaché (sinon conservée + avertissement) → plus de `ligneLivraisonId` remis
 *   à NULL sur des dépotages réels (faux « manquants critiques »).
 * Retourne les avertissements de préservation. À exécuter dans une transaction.
 */
async function replaceLignesPreservees(
  tx: Prisma.TransactionClient,
  blId: string,
  lignes: { siteId: string; volumePrevuLitres: number }[]
): Promise<string[]> {
  const warnings: string[] = [];
  const existantes = await tx.ligneLivraison.findMany({
    where: { bonLivraisonId: blId },
    include: { _count: { select: { depotages: true } }, site: { select: { code: true } } },
  });
  const sitesCibles = new Set(lignes.map((l) => l.siteId));
  for (const l of existantes) {
    if (sitesCibles.has(l.siteId)) continue; // conservée (mise à jour ci-dessous)
    if (l._count.depotages > 0) {
      warnings.push(`Ligne ${l.site.code} conservée : des dépotages y sont déjà rattachés.`);
    } else {
      await tx.ligneLivraison.delete({ where: { id: l.id } });
    }
  }
  for (const l of lignes) {
    await tx.ligneLivraison.upsert({
      where: { bonLivraisonId_siteId: { bonLivraisonId: blId, siteId: l.siteId } },
      create: { bonLivraisonId: blId, siteId: l.siteId, volumePrevuLitres: l.volumePrevuLitres },
      update: { volumePrevuLitres: l.volumePrevuLitres }, // préserve volumeLivre/statut/dépotages
    });
  }
  return warnings;
}

/**
 * Génère / édite le plan de livraison d'un bon de livraison (réservé MANAGER/ADMIN).
 * Remplace les lignes en PRÉSERVANT les livraisons déjà rattachées ; Σ = volume chargé.
 */
export async function setPlanLivraison(req: Request, res: Response, next: NextFunction) {
  try {
    const bl = await prisma.bonLivraison.findUnique({ where: { id: req.params.id } });
    if (!bl) throw new AppError('Bon de livraison introuvable', 404);

    const lignes = parseLignes(req.body.lignes);
    const { warnings: planWarn } = await validatePlan(bl.bonCommandeId, bl.mois, n(bl.volumeChargeLitres), lignes, bl.id);

    const updated = await prisma.$transaction(async (tx) => {
      const preserveWarn = await replaceLignesPreservees(tx, bl.id, lignes);
      const full = await tx.bonLivraison.findUnique({
        where: { id: bl.id },
        include: { lignes: { include: { site: { select: { code: true, nom: true } } } } },
      });
      return { full, preserveWarn };
    });
    await auditLog(req.user!.id, 'UPDATE', 'bons_livraison', bl.id, { plan: lignes.length }, req);
    clearMemo();
    res.json({ success: true, data: updated.full, warnings: [...planWarn, ...updated.preserveWarn] });
  } catch (err) { next(err); }
}

/** Charge un BL avec son plan détaillé (helper d'export). */
async function loadPlan(id: string) {
  return prisma.bonLivraison.findUnique({
    where: { id },
    include: {
      bonCommande: { select: { numero: true } },
      transporteur: { select: { nom: true } },
      lignes: { orderBy: { createdAt: 'asc' }, include: { site: { select: { code: true, nom: true, region: true } } } },
    },
  });
}

export async function exportPlanLivraisonXlsx(req: Request, res: Response, next: NextFunction) {
  try {
    const bl = await loadPlan(req.params.id);
    if (!bl) throw new AppError('Bon de livraison introuvable', 404);
    await assertTransporteurAccess(req, bl.transporteurId);
    const buffer = await buildXlsx(
      `Plan ${bl.numeroBL}`.slice(0, 28),
      [
        { header: 'Site', key: 'site', width: 14 },
        { header: 'Nom', key: 'nom', width: 26 },
        { header: 'Région', key: 'region', width: 16 },
        { header: 'Volume prévu (L)', key: 'prevu', width: 16 },
      ],
      bl.lignes.map((l) => ({ site: l.site.code, nom: l.site.nom, region: l.site.region, prevu: n(l.volumePrevuLitres) }))
    );
    setXlsxHeaders(res, `plan-${bl.numeroBL}.xlsx`);
    res.send(buffer);
  } catch (err) { next(err); }
}

export async function exportPlanLivraisonPdf(req: Request, res: Response, next: NextFunction) {
  try {
    const bl = await loadPlan(req.params.id);
    if (!bl) throw new AppError('Bon de livraison introuvable', 404);
    await assertTransporteurAccess(req, bl.transporteurId);
    const buffer = await generatePlanLivraisonPdf({
      numeroBL: bl.numeroBL,
      bcNumero: bl.bonCommande?.numero,
      moisLabel: MOIS[bl.mois] ?? String(bl.mois),
      annee: bl.annee,
      immatriculation: bl.immatriculation,
      transporteur: bl.transporteur?.nom,
      numeroClient: bl.numeroClient,
      volumeChargeLitres: n(bl.volumeChargeLitres),
      dateChargement: bl.dateChargement,
      lignes: bl.lignes.map((l) => ({ siteCode: l.site.code, siteNom: l.site.nom, region: l.site.region, volumePrevuLitres: n(l.volumePrevuLitres) })),
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="plan-${bl.numeroBL}.pdf"`);
    res.send(buffer);
  } catch (err) { next(err); }
}

// ── SUIVI DES MANQUANTS DE LIVRAISON ──────────────────────────

function manquantsFilter(req: Request): { bonCommandeId?: string; mois?: number; annee?: number; region?: string } {
  const { bc_id, mois, annee, region } = req.query as Record<string, string>;
  return {
    bonCommandeId: bc_id || undefined,
    mois: mois ? parseInt(mois) : undefined,
    annee: annee ? parseInt(annee) : undefined,
    region: region || undefined,
  };
}

/** Détail des lignes de plan d'un site : quels BL l'ont laissé à découvert. */
export async function getManquantsSite(req: Request, res: Response, next: NextFunction) {
  try {
    const f = manquantsFilter(req);
    const blWhere: Prisma.BonLivraisonWhereInput = { statut: { not: 'ANNULE' }, isBrouillon: false };
    if (f.bonCommandeId) blWhere.bonCommandeId = f.bonCommandeId;
    if (f.mois) blWhere.mois = f.mois;
    if (f.annee) blWhere.annee = f.annee;
    if (!f.bonCommandeId && !f.annee) blWhere.annee = new Date().getFullYear();

    const [site, lignes] = await Promise.all([
      prisma.site.findUnique({ where: { id: req.params.id }, select: { code: true, nom: true, region: true } }),
      prisma.ligneLivraison.findMany({
        where: { siteId: req.params.id, bonLivraison: blWhere },
        include: {
          bonLivraison: { select: { id: true, numeroBL: true, mois: true, annee: true, dateChargement: true, immatriculation: true, bonCommande: { select: { numero: true } }, transporteur: { select: { nom: true } } } },
          depotages: { select: { volumeLitres: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    if (!site) throw new AppError('Site introuvable', 404);

    const seuilJours = getNum('manquant.delaiJours', env.DELAI_MANQUANT_JOURS);
    const now = Date.now();
    const data = lignes.map((l) => {
      const prevu = n(l.volumePrevuLitres);
      const livre = l.depotages.reduce((s, d) => s + n(d.volumeLitres), 0);
      const manquant = Math.max(0, prevu - livre);
      const jours = Math.floor((now - l.bonLivraison.dateChargement.getTime()) / 86_400_000);
      return {
        ligneId: l.id,
        blId: l.bonLivraison.id,
        numeroBL: l.bonLivraison.numeroBL,
        bcNumero: l.bonLivraison.bonCommande.numero,
        transporteur: l.bonLivraison.transporteur?.nom ?? null,
        immatriculation: l.bonLivraison.immatriculation,
        mois: l.bonLivraison.mois,
        annee: l.bonLivraison.annee,
        dateChargement: l.bonLivraison.dateChargement,
        jours,
        prevu: Math.round(prevu),
        livre: Math.round(livre),
        manquant: Math.round(manquant),
        statut: l.statut,
        enRetard: manquant > 0.5 && jours > seuilJours,
      };
    });

    res.json({ success: true, data: { site, lignes: data } });
  } catch (err) { next(err); }
}

export async function getManquantsLivraison(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await computeManquants(manquantsFilter(req));
    // lignesEnRetard sert au job d'alerte ; on ne l'expose pas dans l'API.
    const { lignesEnRetard: _omit, ...rest } = data;
    res.json({ success: true, data: rest });
  } catch (err) { next(err); }
}

export async function exportManquantsLivraison(req: Request, res: Response, next: NextFunction) {
  try {
    const m = await computeManquants(manquantsFilter(req));
    const sheets = [
      {
        name: 'Par site',
        columns: [
          { header: 'Site', key: 'siteCode', width: 14 },
          { header: 'Nom', key: 'siteNom', width: 24 },
          { header: 'Région', key: 'region', width: 16 },
          { header: 'Prévu (L)', key: 'prevu', width: 12 },
          { header: 'Livré (L)', key: 'livre', width: 12 },
          { header: 'Manquant (L)', key: 'manquant', width: 14 },
          { header: 'Lignes en retard', key: 'nbEnRetard', width: 16 },
        ],
        rows: m.parSite as unknown as Record<string, unknown>[],
      },
      {
        name: 'Par camion',
        columns: [
          { header: 'N° BL', key: 'numeroBL', width: 16 },
          { header: 'BC', key: 'bcNumero', width: 14 },
          { header: 'Camion', key: 'immatriculation', width: 14 },
          { header: 'Chargé (L)', key: 'charge', width: 12 },
          { header: 'Distribué (L)', key: 'distribue', width: 14 },
          { header: 'Manquant (L)', key: 'manquant', width: 14 },
          { header: 'Sites manquants', key: 'nbSitesManquants', width: 16 },
        ],
        rows: m.parCamion as unknown as Record<string, unknown>[],
      },
      {
        name: 'Par mois',
        columns: [
          { header: 'BC', key: 'bcNumero', width: 14 },
          { header: 'Année', key: 'annee', width: 8 },
          { header: 'Mois', key: 'mois', width: 8 },
          { header: 'Prévu (L)', key: 'prevu', width: 12 },
          { header: 'Chargé (L)', key: 'charge', width: 12 },
          { header: 'Livré (L)', key: 'livre', width: 12 },
          { header: 'Manquant chargé (L)', key: 'manquantCharge', width: 18 },
          { header: 'Manquant livré (L)', key: 'manquantLivre', width: 18 },
        ],
        rows: m.parMois as unknown as Record<string, unknown>[],
      },
      {
        name: 'Par bon de commande',
        columns: [
          { header: 'BC', key: 'numero', width: 16 },
          { header: 'Année', key: 'annee', width: 8 },
          { header: 'Trimestre', key: 'trimestre', width: 10 },
          { header: 'Prévu (L)', key: 'prevu', width: 12 },
          { header: 'Chargé (L)', key: 'charge', width: 12 },
          { header: 'Livré (L)', key: 'livre', width: 12 },
          { header: 'Manquant (L)', key: 'manquant', width: 14 },
        ],
        rows: m.parBc as unknown as Record<string, unknown>[],
      },
    ];
    await sendTabular(res, req.params.format, 'manquants-livraison', 'Suivi des manquants de livraison', sheets);
  } catch (err) { next(err); }
}

// ── RÉAPPROVISIONNEMENT PRÉDICTIF ─────────────────────────────

export async function getReapprovisionnement(req: Request, res: Response, next: NextFunction) {
  try {
    const { region, horizon } = req.query as Record<string, string>;
    const horizonJours = horizon ? parseInt(horizon) : getNum('appro.horizonJours', env.APPRO_HORIZON_JOURS);
    // forecast complet (mémoïsé) partagé avec la détection d'anomalies du même écran.
    const sitesAll = await forecastSites({ region: region || undefined, all: true });
    const sites = sitesAll.filter((s) => s.autonomieJours != null && s.autonomieJours <= horizonJours);
    const tournees = suggestTournees(sites);
    res.json({
      success: true,
      data: {
        sites,
        tournees,
        params: {
          leadTimeJours: getNum('appro.leadTimeJours', env.APPRO_LEAD_TIME_JOURS),
          securiteJours: getNum('appro.securiteJours', env.APPRO_STOCK_SECURITE_JOURS),
          horizonJours: horizon ? parseInt(horizon) : getNum('appro.horizonJours', env.APPRO_HORIZON_JOURS),
          capaciteCamion: getNum('appro.camionCapaciteLitres', env.CAMION_CAPACITE_LITRES),
        },
        totaux: {
          nbSites: sites.length,
          nbCritiques: sites.filter((s) => s.priorite === 'CRITIQUE').length,
          volumeRecommande: sites.reduce((s, x) => s + x.quantiteRecommandee, 0),
          nbTournees: tournees.length,
          totalKm: Math.round(tournees.reduce((s, x) => s + x.distanceKm, 0) * 10) / 10,
          tauxRemplissageMoyen: tournees.length ? Math.round(tournees.reduce((s, x) => s + x.tauxRemplissage, 0) / tournees.length) : 0,
        },
      },
    });
  } catch (err) { next(err); }
}

export async function getAnomaliesConso(req: Request, res: Response, next: NextFunction) {
  try {
    const { region } = req.query as Record<string, string>;
    const anomalies = await detectAnomalies({ region: region || undefined });
    res.json({
      success: true,
      data: {
        anomalies,
        totaux: {
          nb: anomalies.length,
          nbElevees: anomalies.filter((a) => a.severite === 'ELEVEE').length,
          nbSurconso: anomalies.filter((a) => a.type === 'SURCONSOMMATION').length,
        },
      },
    });
  } catch (err) { next(err); }
}

export async function getSyntheseAppro(req: Request, res: Response, next: NextFunction) {
  try {
    const { region } = req.query as Record<string, string>;
    const synthese = await generateSynthese({ region: region || undefined });
    res.json({ success: true, data: synthese });
  } catch (err) { next(err); }
}

/**
 * Crée un BON DE LIVRAISON BROUILLON (statut PLANIFIE) à partir d'une tournée
 * suggérée : entête à compléter (numéro/camion auto-générés), plan pré-rempli.
 * Le manager finalise l'entête puis le transporteur prend le relais.
 */
export async function createBrouillonLivraison(req: Request, res: Response, next: NextFunction) {
  try {
    const { bonCommandeId, mois, annee, lignes } = req.body;
    if (!bonCommandeId) throw new AppError('Bon de commande requis', 400);
    const bc = await prisma.bonCommande.findUnique({ where: { id: bonCommandeId } });
    if (!bc) throw new AppError('Bon de commande introuvable', 404);

    const plan = parseLignes(lignes);
    if (!plan.length) throw new AppError('Aucun site dans la tournée', 400);
    const m = Math.trunc(n(mois)) || (new Date().getMonth() + 1);
    const volume = plan.reduce((s, l) => s + l.volumePrevuLitres, 0);
    // Suffixe aléatoire en plus du timestamp → pas de collision sur la même milliseconde.
    const ref = Date.now().toString(36).toUpperCase().slice(-6) + Math.random().toString(36).slice(2, 5).toUpperCase();

    const bl = await prisma.bonLivraison.create({
      data: {
        bonCommandeId,
        numeroBL: `BR-${ref}`,                 // brouillon : à remplacer par le N° réel
        isBrouillon: true,
        mois: m < 1 || m > 12 ? new Date().getMonth() + 1 : m,
        annee: Math.trunc(n(annee)) || bc.annee,
        immatriculation: 'À AFFECTER',
        volumeChargeLitres: volume,
        numeroClient: bc.numeroClient,
        dateChargement: new Date(),
        statut: 'PLANIFIE',
        observations: 'Brouillon généré par le réapprovisionnement prédictif',
        lignes: { create: plan },
      },
      include: { lignes: true },
    });
    await auditLog(req.user!.id, 'CREATE', 'bons_livraison', bl.id, { brouillon: true, sites: plan.length }, req);
    clearMemo();
    res.status(201).json({ success: true, data: bl });
  } catch (err) { next(mapKnownError(err, 'Conflit de numéro de bon de livraison')); }
}

/** Lignes de plan de livraison ouvertes pour un site (consommé par le mobile au dépotage). */
export async function getLignesLivraisonForSite(req: Request, res: Response, next: NextFunction) {
  try {
    await assertSiteInPerimetre(req.user!.id, req.params.id);
    const lignes = await prisma.ligneLivraison.findMany({
      where: {
        siteId: req.params.id,
        statut: { in: ['PREVU', 'PARTIEL'] },
        bonLivraison: { statut: { not: 'ANNULE' }, isBrouillon: false }, // pas de dépotage sur un brouillon
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

// ── EXPORTS EXCEL ─────────────────────────────────────────────

export async function exportBonsCommande(req: Request, res: Response, next: NextFunction) {
  try {
    const { annee, trimestre } = req.query as Record<string, string>;
    const where: Prisma.BonCommandeWhereInput = {};
    if (annee) where.annee = parseInt(annee);
    if (trimestre) where.trimestre = parseInt(trimestre);

    const rows = await prisma.bonCommande.findMany({
      where,
      orderBy: [{ annee: 'desc' }, { trimestre: 'desc' }],
      include: { volumesMensuels: true, _count: { select: { bonsLivraison: true } } },
    });

    await auditLog(req.user!.id, 'EXPORT', 'bons_commande', undefined, { count: rows.length }, req);
    await sendTabular(res, req.params.format, 'bons-commande', 'Bons de commande carburant', [{
      name: 'Bons de commande',
      columns: [
        { header: 'N° BC', key: 'numero', width: 18 },
        { header: 'Année', key: 'annee', width: 8 },
        { header: 'Trimestre', key: 'trimestre', width: 10 },
        { header: 'N° client', key: 'client', width: 16 },
        { header: 'Volume prévu (L)', key: 'volume', width: 16 },
        { header: 'Bons de livraison', key: 'bl', width: 16 },
        { header: 'Statut', key: 'statut', width: 12 },
      ],
      rows: rows.map((b) => ({
        numero: b.numero,
        annee: b.annee,
        trimestre: `T${b.trimestre}`,
        client: b.numeroClient,
        volume: b.volumesMensuels.reduce((s, v) => s + n(v.volumePrevuLitres), 0),
        bl: b._count.bonsLivraison,
        statut: b.statut,
      })),
    }]);
  } catch (err) { next(err); }
}

export async function exportBonsLivraison(req: Request, res: Response, next: NextFunction) {
  try {
    const { bon_commande_id, mois, annee } = req.query as Record<string, string>;
    const where: Prisma.BonLivraisonWhereInput = {};
    if (bon_commande_id) where.bonCommandeId = bon_commande_id;
    if (mois) where.mois = parseInt(mois);
    if (annee) where.annee = parseInt(annee);

    // Une ligne du tableau = une ligne de plan (site) du bon de livraison.
    const bls = await prisma.bonLivraison.findMany({
      where,
      orderBy: { dateChargement: 'desc' },
      include: {
        bonCommande: { select: { numero: true } },
        lignes: { include: { site: { select: { code: true, nom: true, region: true } } } },
      },
    });

    const rows: Record<string, unknown>[] = [];
    for (const bl of bls) {
      if (bl.lignes.length === 0) {
        rows.push({ bl: bl.numeroBL, bc: bl.bonCommande?.numero ?? '', mois: MOIS[bl.mois], annee: bl.annee, camion: bl.immatriculation, charge: n(bl.volumeChargeLitres), site: '', region: '', prevu: '', livre: '', statut: bl.statut });
        continue;
      }
      for (const l of bl.lignes) {
        rows.push({
          bl: bl.numeroBL,
          bc: bl.bonCommande?.numero ?? '',
          mois: MOIS[bl.mois],
          annee: bl.annee,
          camion: bl.immatriculation,
          charge: n(bl.volumeChargeLitres),
          site: l.site.code,
          region: l.site.region,
          prevu: n(l.volumePrevuLitres),
          livre: l.volumeLivreLitres != null ? n(l.volumeLivreLitres) : '',
          statut: l.statut,
        });
      }
    }

    await auditLog(req.user!.id, 'EXPORT', 'bons_livraison', undefined, { count: bls.length }, req);
    await sendTabular(res, req.params.format, 'bons-livraison', 'Bons de livraison carburant', [{
      name: 'Bons de livraison',
      columns: [
        { header: 'N° BL', key: 'bl', width: 16 },
        { header: 'BC', key: 'bc', width: 16 },
        { header: 'Mois', key: 'mois', width: 12 },
        { header: 'Année', key: 'annee', width: 8 },
        { header: 'Camion', key: 'camion', width: 14 },
        { header: 'Volume chargé (L)', key: 'charge', width: 16 },
        { header: 'Site', key: 'site', width: 14 },
        { header: 'Région', key: 'region', width: 16 },
        { header: 'Prévu site (L)', key: 'prevu', width: 14 },
        { header: 'Livré site (L)', key: 'livre', width: 14 },
        { header: 'Statut ligne', key: 'statut', width: 12 },
      ],
      rows,
    }]);
  } catch (err) { next(err); }
}

// ── CORRÉLATION APPRO ↔ CONSOMMATION ÉNERGIE ──────────────────

/**
 * Compare, par site et sur une période, le carburant LIVRÉ (dépotages réels)
 * à la consommation ÉNERGIE (gasoil brûlé par les GE, issu des relevés).
 * Met en évidence les écarts anormaux (pertes / vol / heures sous-déclarées).
 */
export async function getCorrelationCarburant(req: Request, res: Response, next: NextFunction) {
  try {
    const { region, periode = '180' } = req.query as Record<string, string>;
    const jours = parseInt(periode) || 180;
    const since = new Date(Date.now() - jours * 24 * 60 * 60 * 1000);
    const siteFilter = region ? { region } : {};

    const sites = await prisma.site.findMany({
      where: { isActive: true, ...siteFilter },
      select: { id: true, code: true, nom: true, region: true },
      orderBy: { code: 'asc' },
    });

    const [depotages, releves] = await Promise.all([
      prisma.depotage.groupBy({
        by: ['siteId'],
        where: { dateDepotage: { gte: since }, site: siteFilter },
        _sum: { volumeLitres: true },
      }),
      prisma.releveEnergie.groupBy({
        by: ['siteId'],
        where: { dateReleve: { gte: since }, source: 'GE', site: siteFilter },
        _sum: { gasoilConsommeLitres: true, heuresFonctGE: true, consommationKwh: true },
      }),
    ]);

    const livreMap = new Map(depotages.map((d) => [d.siteId, n(d._sum.volumeLitres)]));
    const consoMap = new Map(releves.map((r) => [r.siteId, r._sum]));

    const lignes = sites.map((s) => {
      const livre = livreMap.get(s.id) ?? 0;
      const sums = consoMap.get(s.id);
      const consomme = n(sums?.gasoilConsommeLitres);
      const heuresGE = n(sums?.heuresFonctGE);
      const kwh = n(sums?.consommationKwh);
      const ecart = livre - consomme; // > 0 attendu (reste en cuve) ; << 0 anormal
      // Anomalie si la conso dépasse nettement le livré (> 15 %) ou écart inverse marqué.
      const ratio = consomme > 0 ? livre / consomme : null;
      const anomalie = consomme > 0 && livre > 0 && ratio !== null && ratio < 0.85;
      return {
        siteId: s.id, code: s.code, nom: s.nom, region: s.region,
        livreLitres: Math.round(livre),
        consommeLitres: Math.round(consomme),
        ecartLitres: Math.round(ecart),
        heuresGE: Math.round(heuresGE),
        consoKwh: Math.round(kwh),
        ratio: ratio !== null ? Math.round(ratio * 100) / 100 : null,
        anomalie,
      };
    });

    const totaux = lignes.reduce(
      (a, l) => ({ livre: a.livre + l.livreLitres, consomme: a.consomme + l.consommeLitres }),
      { livre: 0, consomme: 0 }
    );

    res.json({
      success: true,
      data: {
        periodeJours: jours,
        totaux: { livreLitres: totaux.livre, consommeLitres: totaux.consomme, ecartLitres: totaux.livre - totaux.consomme },
        nbAnomalies: lignes.filter((l) => l.anomalie).length,
        lignes,
      },
    });
  } catch (err) { next(err); }
}

/** Traduit les erreurs Prisma connues (contrainte d'unicité) en AppError lisible. */
function mapKnownError(err: unknown, uniqueMsg: string): unknown {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    return new AppError(uniqueMsg, 409);
  }
  return err;
}
