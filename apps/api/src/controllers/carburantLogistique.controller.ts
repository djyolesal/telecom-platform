import { publicFileUrl, uploadBuffer, cleMinioValide } from '../services/storage.service';
import { analyserBonCommandePdf as analyserBcPdf } from '../services/bcPdf.service';
import { analyserBonLivraisonDocument as analyserBlDoc } from '../services/blPdf.service';
import { syncStatutBonLivraison } from './depotages.controller';
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
import { computeManquants, computePilotageBL } from '../services/manquants.service';
import { rapprochementBc } from '../services/rapprochement.service';
import { resoudreVehicule, resoudreChauffeur, depassementCiterne } from '../services/referentielTransport.service';
import { nomUtilisable } from '../utils/referentielTransport';
import { verrouSiteCarburant } from '../services/verrou.service';
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

    // Suivi par mois. On distingue CHARGÉ (monté dans le camion) et LIVRÉ
    // (réellement dépoté sur les sites) : la colonne était intitulée « livré »
    // alors qu'elle portait le chargé — le manager pilotait son trimestre sur un
    // chiffre qui ignorait tout ce qui n'était pas descendu du camion.
    const charge = new Map<number, number>();
    const blIds: string[] = [];
    const moisParBl = new Map<string, number>();
    for (const bl of bc.bonsLivraison) {
      if (bl.statut === 'ANNULE' || bl.isBrouillon) continue; // brouillon = pas un chargement réel
      charge.set(bl.mois, (charge.get(bl.mois) ?? 0) + n(bl.volumeChargeLitres));
      blIds.push(bl.id);
      moisParBl.set(bl.id, bl.mois);
    }

    // Volumes réellement dépotés, rattachés au mois du chargement d'origine.
    const livreParMois = new Map<number, number>();
    if (blIds.length) {
      const deps = await prisma.depotage.findMany({
        where: { ligneLivraison: { bonLivraisonId: { in: blIds } } },
        select: { volumeLitres: true, ligneLivraison: { select: { bonLivraisonId: true } } },
      });
      for (const d of deps) {
        const mois = moisParBl.get(d.ligneLivraison?.bonLivraisonId ?? '');
        if (mois != null) livreParMois.set(mois, (livreParMois.get(mois) ?? 0) + n(d.volumeLitres));
      }
    }

    const suivi = bc.volumesMensuels.map((vm) => {
      const chargeMois = charge.get(vm.mois) ?? 0;
      const livreMois = livreParMois.get(vm.mois) ?? 0;
      const prevu = n(vm.volumePrevuLitres);
      return {
        mois: vm.mois,
        prevu,
        charge: chargeMois,
        livre: livreMois,
        // `ecart` reste calculé sur le CHARGÉ : c'est lui qui engage le BC
        // vis-à-vis du fournisseur (le dépassement se juge à la commande).
        ecart: chargeMois - prevu,
        depassement: chargeMois > prevu + TOLERANCE_L,
        // Ce qui est monté dans le camion mais pas encore descendu.
        enCours: Math.max(0, chargeMois - livreMois),
      };
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
    // Le PDF du bon de commande est la pièce signée qui ENGAGE les volumes du
    // trimestre : tout le suivi (commandé vs livré, dépassements, pénalités) s'y
    // adosse. Un BC saisi sans son document n'est pas opposable — obligatoire à
    // la création. (La modification d'un BC existant n'est pas bloquée : les BC
    // déjà en base sans PDF restent éditables.)
    if (!bcPdfPath) throw new AppError('Document du bon de commande requis (PDF)', 400);
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
        bcPdfPath: cleMinioValide(bcPdfPath),
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

    // Remplacement complet des volumes mensuels si fournis. GARDE-FOU : on ne
    // peut pas ramener le prévu d'un mois SOUS ce qui a déjà été chargé — sinon
    // on efface rétroactivement un dépassement réel (mars ramené à 0 L alors que
    // 40 000 L sont partis), et le suivi du BC ment sur le trimestre.
    if (req.body.volumesMensuels !== undefined) {
      const volumes = parseVolumes(req.body.volumesMensuels);
      const chargesParMois = await prisma.bonLivraison.groupBy({
        by: ['mois'],
        where: { bonCommandeId: existing.id, isBrouillon: false, statut: { not: 'ANNULE' } },
        _sum: { volumeChargeLitres: true },
      });
      const prevuParMois = new Map(volumes.map((v) => [v.mois, v.volumePrevuLitres]));
      for (const c of chargesParMois) {
        const dejaCharge = n(c._sum.volumeChargeLitres);
        const nouveauPrevu = prevuParMois.get(c.mois) ?? 0;
        if (dejaCharge > nouveauPrevu + TOLERANCE_L) {
          throw new AppError(
            `Mois ${MOIS[c.mois] ?? c.mois} : ${dejaCharge.toLocaleString('fr-FR')} L ont déjà été chargés, ` +
            `le volume prévu ne peut pas être ramené à ${nouveauPrevu.toLocaleString('fr-FR')} L.`,
            409
          );
        }
      }
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
          chauffeur: { select: { nom: true } },
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
        chauffeur: { select: { id: true, nom: true, telephone: true } },
        vehicule: { select: { id: true, libelle: true, capaciteCiterneLitres: true } },
        // Reports REÇUS d'autres chargements : physiquement dans cette citerne.
        reportsRecus: { select: { id: true, numeroBL: true, resteReportLitres: true } },
        reportSurBl: { select: { id: true, numeroBL: true } },
        lignes: {
          orderBy: { createdAt: 'asc' },
          include: {
            // Coordonnées incluses : le transporteur doit rejoindre physiquement
            // CES sites (uniquement ceux de SON plan) — elles alimentent le
            // bouton « Itinéraire » du web et du mobile.
            site: { select: { code: true, nom: true, region: true, latitude: true, longitude: true } },
            depotages: { select: { id: true, dateDepotage: true, volumeLitres: true }, orderBy: { dateDepotage: 'asc' } },
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

    // Reste en citerne et sa ventilation : le camion n'est soldé que si le reste
    // est expliqué (retour dépôt / perte / report), pas quand il est simplement
    // faible. `resteAExpliquer` est ce qui reste à décider.
    const totalLivre = lignes.reduce((t, l) => t + l.volumeLivreReel, 0);
    // Volume RÉELLEMENT embarqué = chargé au dépôt + reports reçus d'autres
    // chargements. Sans les compter, ce camion livrait plus qu'il n'avait
    // « chargé » et ressortait en sur-livraison.
    const reportRecu = bl.reportsRecus.reduce((t, r) => t + n(r.resteReportLitres), 0);
    const reste = n(bl.volumeChargeLitres) + reportRecu - totalLivre;
    const ventile = n(bl.resteRetourDepotLitres) + n(bl.restePerteLitres) + n(bl.resteReportLitres);

    res.json({
      success: true,
      data: {
        ...bl,
        lignes,
        sommeLignes,
        blPdfUrl: bl.blPdfPath ? publicFileUrl(bl.blPdfPath) : null,
        bordereauPdfUrl: bl.bordereauPdfPath ? publicFileUrl(bl.bordereauPdfPath) : null,
        bonRetourUrl: bl.bonRetourPath ? publicFileUrl(bl.bonRetourPath) : null,
        coherenceCharge: Math.abs(sommeLignes - (n(bl.volumeChargeLitres) + reportRecu)) <= TOLERANCE_L,
        totalLivre: Math.round(totalLivre),
        reportRecu: Math.round(reportRecu),
        volumeDisponible: Math.round(n(bl.volumeChargeLitres) + reportRecu),
        reste: Math.round(reste),
        resteVentile: Math.round(ventile),
        resteAExpliquer: Math.round(reste - ventile),
        estClos: bl.dateCloture != null,
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
    const { bonCommandeId, numeroBL, mois, annee, immatriculation, volumeChargeLitres, dateChargement, dateTraitement, observations, statut, blPdfPath, bordereauPdfPath, numeroClient } = req.body;
    if (!bonCommandeId) throw new AppError('Bon de commande requis', 400);
    if (!numeroBL) throw new AppError('Numéro de bon de livraison requis', 400);
    if (!immatriculation) throw new AppError('Immatriculation du camion requise', 400);
    // Un chargement déclaré doit être adossé à SES DEUX pièces : le bon de
    // livraison (ce que le fournisseur a émis) et le bordereau de chargement (ce
    // qui est réellement sorti du dépôt). Sans elles, l'écart camion n'est
    // contestable ni dans un sens ni dans l'autre. Obligatoires à la création
    // (les brouillons du réappro prédictif ne passent pas par ici).
    if (!blPdfPath) throw new AppError('Document du bon de livraison requis (photo ou PDF)', 400);
    if (!bordereauPdfPath) throw new AppError('Bordereau de chargement requis (photo ou PDF)', 400);
    // La date de chargement ne figure PAS sur le BL : c'est une saisie humaine
    // obligatoire — un défaut silencieux « aujourd'hui » fabriquait une donnée.
    if (!dateChargement) throw new AppError('Date de chargement du camion requise', 400);
    const dateChargementValide = new Date(String(dateChargement));
    if (Number.isNaN(dateChargementValide.getTime())) throw new AppError('Date de chargement invalide', 400);

    const bc = await prisma.bonCommande.findUnique({ where: { id: bonCommandeId } });
    if (!bc) throw new AppError('Bon de commande introuvable', 404);
    // Un BC clôturé ou annulé n'accepte plus de chargement : sans ce contrôle,
    // un BL retardataire saisi en mai repeuplait un T1 déjà arrêté et facturé,
    // et modifiait rétroactivement le manquant du trimestre.
    if (bc.statut !== 'OUVERT') {
      throw new AppError(
        `Le bon de commande ${bc.numero} est ${bc.statut.toLowerCase()} : il n'accepte plus de chargement.`,
        409
      );
    }

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

    // CHAUFFEUR DÉCLARÉ AU DÉPART. La signature du chauffeur était bloquante au
    // dépotage, son nom ne l'était pas : on exigeait une signature manuscrite
    // sans exiger de savoir qui signe — sans valeur en litige. Déclaré ici, il
    // devient confrontable au signataire réel sur le terrain.
    const nomChauffeur = req.body.nomChauffeur ?? req.body.chauffeurNom;
    if (!req.body.chauffeurId && !nomUtilisable(nomChauffeur)) {
      throw new AppError('Nom du chauffeur requis : il sera confronté au chauffeur qui signera sur site.', 400);
    }

    // Référentiels résolus DANS la transaction de création : un bon de livraison
    // refusé (numéro dupliqué, volume au-delà de la citerne) laissait sinon
    // derrière lui un camion et un chauffeur créés pour rien.
    const bl = await prisma.$transaction(async (tx) => {
      const chauffeur = req.body.chauffeurId
        ? await tx.chauffeur.findUnique({ where: { id: String(req.body.chauffeurId) }, select: { id: true, nom: true } })
        : await resoudreChauffeur(nomChauffeur, transporteurId, tx);
      if (!chauffeur) throw new AppError('Chauffeur introuvable.', 404);

      // VÉHICULE : le référentiel se construit à l'usage (une plaque nomme un
      // camion). Quand sa capacité est connue, un chargement qui la dépasse est
      // physiquement impossible et trahit une saisie fausse.
      const vehicule = await resoudreVehicule(immatriculation, transporteurId, tx);
      const dep = depassementCiterne(volume, vehicule?.capaciteCiterneLitres);
      if (dep.depasse) {
        throw new AppError(
          `Volume chargé (${volume.toLocaleString('fr-FR')} L) supérieur à la capacité de la citerne ` +
          `du camion ${String(immatriculation).trim()} (${dep.capacite.toLocaleString('fr-FR')} L). ` +
          `Corrigez le volume, ou la capacité dans la fiche du véhicule.`,
          400
        );
      }

      return tx.bonLivraison.create({
        data: {
          bonCommandeId,
          transporteurId,
          numeroBL: String(numeroBL).trim(),
          mois: m,
          annee: Math.trunc(n(annee)) || bc.annee,
          immatriculation: String(immatriculation).trim(),
          vehiculeId: vehicule?.id ?? null,
          chauffeurId: chauffeur.id,
          volumeChargeLitres: volume,
          // Le BL porte SON PROPRE numéro client (« Votre N° Client » du document,
          // extrait par l'OCR). On le conserve s'il est fourni ; sinon on retombe
          // sur celui du BC (souvent nul depuis qu'il est facultatif).
          numeroClient: numeroClient ? String(numeroClient).slice(0, 50) : bc.numeroClient,
          dateChargement: dateChargementValide,
          dateTraitement: dateTraitement ? new Date(dateTraitement) : null,
          statut: statut ?? undefined,
          blPdfPath: cleMinioValide(blPdfPath),
          bordereauPdfPath: cleMinioValide(bordereauPdfPath),
          observations: observations ?? null,
          ...(lignes.length ? { lignes: { create: lignes } } : {}),
        },
        include: { lignes: { include: { site: { select: { code: true, nom: true } } } } },
      });
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
    // Un numéro VIDE n'est pas une saisie : le formulaire d'entête pré-remplit
    // le champ à '' pour un brouillon (dont le n° BR- est provisoire). Sans ce
    // garde-fou, enregistrer l'entête sans toucher au numéro effaçait le n° du
    // BL (colonne UNIQUE) et déclenchait la finalisation — rendant impossible le
    // simple changement de statut, par exemple pour annuler un brouillon.
    const numeroFourni = numeroBL != null && String(numeroBL).trim() !== '';
    if (numeroFourni) {
      data.numeroBL = String(numeroBL).trim();
      // La finalisation d'un brouillon (vrai numéro) est réservée au manager/admin.
      if (!String(numeroBL).trim().startsWith('BR-') && !isTransporteur) {
        data.isBrouillon = false;
        // Un brouillon (réappro prédictif) porte une date de chargement FABRIQUÉE
        // (new Date() à la génération). À la finalisation, exiger la VRAIE date
        // du chargement : sans cela la date de planification devenait officielle
        // et faussait l'ancienneté et les alertes « en retard ».
        if (existing.isBrouillon && dateChargement == null) {
          throw new AppError('Saisissez la date réelle de chargement du camion pour finaliser ce brouillon.', 400);
        }
        // Un brouillon qui devient un chargement réel doit être adossé à ses
        // deux pièces, comme une création directe.
        if (existing.isBrouillon && !blPdfPath && !existing.blPdfPath) {
          throw new AppError('Joignez le document du bon de livraison pour finaliser ce brouillon.', 400);
        }
        if (existing.isBrouillon && !bordereauPdfPath && !existing.bordereauPdfPath) {
          throw new AppError('Joignez le bordereau de chargement pour finaliser ce brouillon.', 400);
        }
        // Un brouillon n'a pas de chauffeur (il n'existait pas de camion) : le
        // déclarer fait partie de la finalisation, au même titre que les pièces.
        if (existing.isBrouillon && !existing.chauffeurId && !req.body.chauffeurId
            && !(req.body.nomChauffeur ?? req.body.chauffeurNom)) {
          throw new AppError('Déclarez le chauffeur du chargement pour finaliser ce brouillon.', 400);
        }
      }
    }
    if (dateChargement != null) {
      const dc = new Date(String(dateChargement));
      if (Number.isNaN(dc.getTime())) throw new AppError('Date de chargement invalide', 400);
    }
    if (mois != null) {
      const m = Math.trunc(n(mois));
      if (m < 1 || m > 12) throw new AppError('Mois invalide (1..12)', 400);
      data.mois = m;
    }
    if (annee != null) data.annee = Math.trunc(n(annee));
    if (immatriculation != null) data.immatriculation = String(immatriculation).trim();
    if (volumeChargeLitres != null) data.volumeChargeLitres = n(volumeChargeLitres);

    // ── Référentiels transport ────────────────────────────────────────────
    // Le véhicule suit la plaque (le référentiel se construit à l'usage), et le
    // chauffeur déclaré suit le nom saisi. La capacité citerne, quand elle est
    // connue, rend un chargement impossible détectable dès la saisie.
    let vehiculeCourant: { id: string; capaciteCiterneLitres: unknown } | null = null;
    if (immatriculation != null) {
      vehiculeCourant = await resoudreVehicule(immatriculation, existing.transporteurId);
      data.vehicule = vehiculeCourant ? { connect: { id: vehiculeCourant.id } } : { disconnect: true };
    } else if (existing.vehiculeId) {
      vehiculeCourant = await prisma.vehicule.findUnique({
        where: { id: existing.vehiculeId },
        select: { id: true, capaciteCiterneLitres: true },
      });
    }
    const nomChauffeurMaj = req.body.nomChauffeur ?? req.body.chauffeurNom;
    if (req.body.chauffeurId) {
      data.chauffeur = { connect: { id: String(req.body.chauffeurId) } };
    } else if (nomChauffeurMaj != null) {
      const c = await resoudreChauffeur(nomChauffeurMaj, existing.transporteurId);
      if (!c) throw new AppError('Nom du chauffeur invalide.', 400);
      data.chauffeur = { connect: { id: c.id } };
    }
    const volumeEffectif = volumeChargeLitres != null ? n(volumeChargeLitres) : n(existing.volumeChargeLitres);
    const depMaj = depassementCiterne(volumeEffectif, vehiculeCourant?.capaciteCiterneLitres as never);
    if (depMaj.depasse) {
      throw new AppError(
        `Volume chargé (${volumeEffectif.toLocaleString('fr-FR')} L) supérieur à la capacité de la citerne ` +
        `(${depMaj.capacite.toLocaleString('fr-FR')} L). Corrigez le volume, ou la capacité dans la fiche du véhicule.`,
        400
      );
    }
    if (dateChargement != null) data.dateChargement = new Date(dateChargement);
    if (dateTraitement !== undefined) data.dateTraitement = dateTraitement ? new Date(dateTraitement) : null;
    if (observations !== undefined) data.observations = observations;
    if (statut != null) {
      // ANNULER un BL le retire de TOUS les rapports (manquants 4 niveaux, suivi
      // du BC, alerte quotidienne) alors que ses dépotages restent comptés dans
      // le stock. Sans garde, un TRANSPORTEUR pouvait donc effacer son propre
      // manquant d'un clic — la suppression était protégée, pas l'annulation.
      if (statut === 'ANNULE' && existing.statut !== 'ANNULE') {
        if (isTransporteur) throw new AppError("L'annulation d'un bon de livraison est réservée au pilotage.", 403);
        const depotagesLies = await prisma.depotage.count({ where: { ligneLivraison: { bonLivraisonId: existing.id } } });
        if (depotagesLies > 0) {
          throw new AppError(
            `Annulation refusée : ${depotagesLies} dépotage(s) sont rattachés à ce bon de livraison. ` +
            `Le carburant a été livré — corrigez les dépotages avant d'annuler.`,
            409
          );
        }
        const motif = String((req.body as Record<string, unknown>).motifAnnulation ?? '').trim();
        if (motif.length < 5) throw new AppError("Motif d'annulation requis (5 caractères minimum).", 400);
        data.observations = `${existing.observations ? existing.observations + '\n' : ''}[ANNULÉ] ${motif}`;
      }
      data.statut = statut;
    }
    if (blPdfPath !== undefined) data.blPdfPath = cleMinioValide(blPdfPath);
    if (bordereauPdfPath !== undefined) data.bordereauPdfPath = cleMinioValide(bordereauPdfPath);
    if (transporteurId !== undefined && !isTransporteur) {
      data.transporteur = transporteurId ? { connect: { id: transporteurId } } : { disconnect: true };
    }

    // BC clôturé ou annulé : le trimestre est arrêté. On laisse encore corriger
    // l'administratif (documents, observations) et annuler, mais plus rien de ce
    // qui déplacerait des litres dans un trimestre déjà soldé.
    const bcParent = await prisma.bonCommande.findUnique({
      where: { id: existing.bonCommandeId },
      select: { numero: true, statut: true },
    });
    if (bcParent && bcParent.statut !== 'OUVERT') {
      const bloquants = ['volumeChargeLitres', 'mois', 'annee', 'lignes'].filter((k) => req.body[k] !== undefined);
      if (data.isBrouillon === false) bloquants.push('finalisation');
      if (bloquants.length) {
        throw new AppError(
          `Le bon de commande ${bcParent.numero} est ${bcParent.statut.toLowerCase()} : ` +
          `les volumes et le plan de ce chargement ne peuvent plus être modifiés.`,
          409
        );
      }
    }

    let warnings: string[] = [];
    const effMois = data.mois != null ? (data.mois as number) : existing.mois;
    const effVolume = await volumeDisponibleBl(
      existing.id,
      data.volumeChargeLitres != null ? (data.volumeChargeLitres as number) : existing.volumeChargeLitres
    );

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
    // Le plan a pu changer (lignes remplacées, BL finalisé) : le statut suit.
    // Recopié dans la réponse, sinon l'écran réaffiche l'ancien statut.
    const statutSync = await syncStatutBonLivraison(bl.id);
    if (statutSync) bl.statut = statutSync;
    await auditLog(req.user!.id, 'UPDATE', 'bons_livraison', bl.id, { updated: Object.keys(data) }, req);
    clearMemo();
    res.json({ success: true, data: bl, warnings });
  } catch (err) { next(mapKnownError(err, 'Un bon de livraison avec ce numéro existe déjà')); }
}

export async function deleteBonLivraison(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.bonLivraison.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Bon de livraison introuvable', 404);
    // Un BROUILLON est un artefact de planification (généré par le réappro
    // prédictif) : le manager qui pilote l'appro doit pouvoir l'écarter lui-même.
    // Un BL RÉEL, lui, est une pièce d'exploitation → suppression ADMIN seule.
    if (!existing.isBrouillon && req.user!.role !== 'ADMIN') {
      throw new AppError("Seul un administrateur peut supprimer un bon de livraison réel. Passez-le au statut ANNULE.", 403);
    }
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
 * CLÔTURE COMPTABLE d'un chargement : le geste qui manquait pour solder un camion.
 *
 * Le « reste » (chargé − Σ dépotages) était calculé et affiché nulle part
 * décidé : 800 L rentrés au dépôt restaient un manquant camion perpétuel, et
 * rien ne distinguait un retour dépôt d'un siphonnage. Le seul remède était
 * l'annulation du BL — qui effaçait aussi les milliers de litres réellement
 * livrés. La clôture oblige à ventiler ce reste en trois destinations, dont la
 * somme doit égaler le reste au litre près :
 *   retour dépôt (avec bon de retour signé) · perte constatée (avec motif) ·
 *   report sur un autre chargement.
 */
export async function cloturerBonLivraison(req: Request, res: Response, next: NextFunction) {
  try {
    const bl = await prisma.bonLivraison.findUnique({
      where: { id: req.params.id },
      include: {
        lignes: { select: { siteId: true, depotages: { select: { volumeLitres: true } } } },
        reportsRecus: { select: { resteReportLitres: true } },
      },
    });
    if (!bl) throw new AppError('Bon de livraison introuvable', 404);
    if (bl.isBrouillon) throw new AppError("Un brouillon n'a pas de chargement réel à solder. Finalisez-le ou supprimez-le.", 400);
    if (bl.statut === 'ANNULE') throw new AppError('Ce bon de livraison est annulé.', 409);
    if (bl.dateCloture) throw new AppError('Ce chargement est déjà clôturé.', 409);

    const livre = bl.lignes.reduce((t, l) => t + l.depotages.reduce((s, d) => s + n(d.volumeLitres), 0), 0);
    // Chargé au dépôt + reports reçus : c'est ce que la citerne contenait.
    const charge = n(bl.volumeChargeLitres) + bl.reportsRecus.reduce((t, r) => t + n(r.resteReportLitres), 0);
    const reste = charge - livre;
    // Sur-livraison : le camion a déposé PLUS qu'il n'a chargé. Il n'y a rien à
    // ventiler et le défaut est ailleurs (jauge, double saisie, plan) — clôturer
    // graverait l'incohérence.
    if (reste < -TOLERANCE_L) {
      throw new AppError(
        `Ce chargement affiche ${Math.round(-reste).toLocaleString('fr-FR')} L livrés EN PLUS du volume chargé. ` +
        `Corrigez les dépotages ou le volume chargé avant de clôturer.`,
        409
      );
    }

    const retour = Math.max(0, n(req.body.resteRetourDepotLitres));
    const perte = Math.max(0, n(req.body.restePerteLitres));
    const report = Math.max(0, n(req.body.resteReportLitres));
    const motif = String(req.body.motifCloture ?? '').trim();
    const bonRetourPath = cleMinioValide(req.body.bonRetourPath);
    const reportSurBlId = req.body.reportSurBlId ? String(req.body.reportSurBlId) : null;

    const somme = retour + perte + report;
    if (Math.abs(somme - Math.max(0, reste)) > TOLERANCE_L) {
      throw new AppError(
        `La ventilation (${Math.round(somme).toLocaleString('fr-FR')} L) doit égaler le reste en citerne ` +
        `(${Math.round(Math.max(0, reste)).toLocaleString('fr-FR')} L = ${Math.round(charge).toLocaleString('fr-FR')} chargés − ` +
        `${Math.round(livre).toLocaleString('fr-FR')} livrés).`,
        400
      );
    }
    // Une perte constatée est une écriture lourde (elle sort du bilan) : elle
    // s'explique. Un retour dépôt s'appuie sur la pièce signée du dépôt.
    if (perte > TOLERANCE_L && motif.length < 10) {
      throw new AppError('Une perte constatée doit être expliquée (motif de 10 caractères minimum).', 400);
    }
    if (retour > TOLERANCE_L && !bonRetourPath) {
      throw new AppError('Joignez le bon de retour signé du dépôt pour justifier le retour de carburant.', 400);
    }

    if (report > TOLERANCE_L) {
      if (!reportSurBlId) throw new AppError('Indiquez le chargement sur lequel le reste est reporté.', 400);
      if (reportSurBlId === bl.id) throw new AppError('Un chargement ne peut pas se reporter sur lui-même.', 400);
      const cible = await prisma.bonLivraison.findUnique({
        where: { id: reportSurBlId },
        select: { id: true, numeroBL: true, statut: true, isBrouillon: true, dateCloture: true },
      });
      if (!cible) throw new AppError('Chargement de report introuvable', 404);
      if (cible.isBrouillon || cible.statut === 'ANNULE' || cible.dateCloture) {
        throw new AppError(`Le chargement ${cible.numeroBL} ne peut pas recevoir de report (brouillon, annulé ou déjà clôturé).`, 409);
      }
    }

    // Lecture du livré ET écriture dans la MÊME transaction, sous le verrou de
    // chaque site servi : un dépotage synchronisé entre les deux figerait sinon
    // une ventilation qui n'égale plus le reste réel — et un chargement clos
    // sort des alertes, donc l'incohérence deviendrait invisible.
    const maj = await prisma.$transaction(async (tx) => {
      for (const siteId of [...new Set(bl.lignes.map((l) => l.siteId))]) {
        await verrouSiteCarburant(tx, siteId);
      }
      const frais = await tx.bonLivraison.findUnique({
        where: { id: bl.id },
        select: {
          dateCloture: true, volumeChargeLitres: true,
          lignes: { select: { depotages: { select: { volumeLitres: true } } } },
          reportsRecus: { select: { resteReportLitres: true } },
        },
      });
      if (!frais) throw new AppError('Bon de livraison introuvable', 404);
      if (frais.dateCloture) throw new AppError('Ce chargement vient d\'être clôturé.', 409);

      const livreFrais = frais.lignes.reduce((t, l) => t + l.depotages.reduce((x, d) => x + n(d.volumeLitres), 0), 0);
      const chargeFrais = n(frais.volumeChargeLitres) + frais.reportsRecus.reduce((t, r) => t + n(r.resteReportLitres), 0);
      const resteFrais = Math.max(0, chargeFrais - livreFrais);
      if (Math.abs(somme - resteFrais) > TOLERANCE_L) {
        throw new AppError(
          `Une livraison a été enregistrée pendant la saisie : le reste est maintenant de ` +
          `${Math.round(resteFrais).toLocaleString('fr-FR')} L. Reprenez la ventilation.`,
          409
        );
      }

      return tx.bonLivraison.update({
        where: { id: bl.id },
        data: {
          dateCloture: new Date(),
          cloturePar: { connect: { id: req.user!.id } },
          resteRetourDepotLitres: retour,
          restePerteLitres: perte,
          resteReportLitres: report,
          reportSurBl: report > TOLERANCE_L && reportSurBlId ? { connect: { id: reportSurBlId } } : undefined,
          motifCloture: motif || null,
          bonRetourPath: bonRetourPath ?? undefined,
        },
      });
    });
    await auditLog(req.user!.id, 'UPDATE', 'bons_livraison', bl.id, { cloture: { reste: Math.round(reste), retour, perte, report } }, req);
    clearMemo();
    res.json({ success: true, data: maj, message: 'Chargement clôturé' });
  } catch (err) { next(err); }
}

/** Réouverture d'un chargement clôturé (correction) — administrateur seul. */
export async function rouvrirBonLivraison(req: Request, res: Response, next: NextFunction) {
  try {
    const bl = await prisma.bonLivraison.findUnique({ where: { id: req.params.id }, select: { id: true, dateCloture: true } });
    if (!bl) throw new AppError('Bon de livraison introuvable', 404);
    if (!bl.dateCloture) throw new AppError("Ce chargement n'est pas clôturé.", 409);
    const motif = String(req.body.motif ?? '').trim();
    if (motif.length < 5) throw new AppError('Motif de réouverture requis (5 caractères minimum).', 400);

    const maj = await prisma.bonLivraison.update({
      where: { id: bl.id },
      data: {
        dateCloture: null, cloturePar: { disconnect: true },
        resteRetourDepotLitres: null, restePerteLitres: null, resteReportLitres: null,
        reportSurBl: { disconnect: true }, motifCloture: null,
      },
    });
    await auditLog(req.user!.id, 'UPDATE', 'bons_livraison', bl.id, { reouverture: motif }, req);
    clearMemo();
    res.json({ success: true, data: maj, message: 'Chargement rouvert' });
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
/**
 * Volume RÉELLEMENT embarqué par un chargement : chargé au dépôt + reports reçus
 * d'autres chargements. Le plan et la cohérence se mesurent là-dessus, sinon un
 * camion qui reprend le reste d'un autre est jugé sur un volume qu'il n'a pas.
 */
async function volumeDisponibleBl(blId: string, volumeCharge: unknown): Promise<number> {
  const r = await prisma.bonLivraison.aggregate({
    where: { reportSurBlId: blId },
    _sum: { resteReportLitres: true },
  });
  return n(volumeCharge) + n(r._sum.resteReportLitres);
}

export async function setPlanLivraison(req: Request, res: Response, next: NextFunction) {
  try {
    const bl = await prisma.bonLivraison.findUnique({ where: { id: req.params.id } });
    if (!bl) throw new AppError('Bon de livraison introuvable', 404);

    const lignes = parseLignes(req.body.lignes);
    const dispo = await volumeDisponibleBl(bl.id, bl.volumeChargeLitres);
    const { warnings: planWarn } = await validatePlan(bl.bonCommandeId, bl.mois, dispo, lignes, bl.id);

    const updated = await prisma.$transaction(async (tx) => {
      const preserveWarn = await replaceLignesPreservees(tx, bl.id, lignes);
      const full = await tx.bonLivraison.findUnique({
        where: { id: bl.id },
        include: { lignes: { include: { site: { select: { code: true, nom: true } } } } },
      });
      return { full, preserveWarn };
    });
    // Poser (ou vider) le plan fait avancer le statut du BL : PLANIFIE tant
    // qu'aucune ligne n'existe, CHARGE dès qu'il y en a, LIVRE quand tout est
    // soldé. Sans cet appel, le statut restait figé jusqu'au premier dépotage.
    await syncStatutBonLivraison(bl.id);
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

/**
 * Rapprochement trimestriel d'un bon de commande : la page qui répond à
 * « où est passé le carburant du trimestre ? ». Volet logistique par mois +
 * équation de conservation par site.
 */
export async function getRapprochementBc(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await rapprochementBc(req.params.id);
    if (!data) throw new AppError('Bon de commande introuvable', 404);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function exportRapprochementBc(req: Request, res: Response, next: NextFunction) {
  try {
    const m = await rapprochementBc(req.params.id);
    if (!m) throw new AppError('Bon de commande introuvable', 404);
    const sheets = [
      {
        name: 'Par mois',
        columns: [
          { header: 'Mois', key: 'moisLabel', width: 12 },
          { header: 'Commandé (L)', key: 'commande', width: 14 },
          { header: 'Chargé (L)', key: 'charge', width: 14 },
          { header: 'Planifié (L)', key: 'planifie', width: 14 },
          { header: 'Livré au plan (L)', key: 'livrePlan', width: 16 },
          { header: 'Livré hors plan (L)', key: 'livreHorsPlan', width: 18 },
          { header: 'Livré total (L)', key: 'livreTotal', width: 15 },
          { header: 'Retour dépôt (L)', key: 'retourDepot', width: 16 },
          { header: 'Perte (L)', key: 'perte', width: 12 },
          { header: 'Report (L)', key: 'report', width: 12 },
          { header: 'Écart non expliqué (L)', key: 'ecartNonExplique', width: 20 },
          { header: 'BL non clôturés', key: 'nbBlNonClos', width: 15 },
        ],
        rows: m.lignesMois.map((l) => ({ ...l, moisLabel: MOIS[l.mois] ?? String(l.mois) })) as unknown as Record<string, unknown>[],
      },
      {
        name: 'Conservation par site',
        columns: [
          { header: 'Site', key: 'siteCode', width: 14 },
          { header: 'Nom', key: 'siteNom', width: 24 },
          { header: 'Région', key: 'region', width: 16 },
          { header: 'Stock début (L)', key: 'stockDebut', width: 15 },
          { header: 'Livré (L)', key: 'livre', width: 12 },
          { header: 'Stock fin (L)', key: 'stockFin', width: 14 },
          { header: 'Consommé réel (L)', key: 'consoReelle', width: 18 },
          { header: 'Consommé théorique (L)', key: 'consoTheorique', width: 20 },
          { header: 'Écart (L)', key: 'ecart', width: 12 },
          { header: 'Mesure', key: 'motifNonMesure', width: 34 },
        ],
        rows: m.conservation.map((c) => ({
          ...c,
          stockDebut: c.stockDebut ?? '', stockFin: c.stockFin ?? '',
          consoReelle: c.consoReelle ?? '', consoTheorique: c.consoTheorique ?? '', ecart: c.ecart ?? '',
          motifNonMesure: c.motifNonMesure ?? 'Mesuré',
        })) as unknown as Record<string, unknown>[],
      },
    ];
    await sendTabular(
      res, req.params.format, `rapprochement-${m.bc.numero}`,
      `Rapprochement carburant — BC ${m.bc.numero}`, sheets,
      `T${m.bc.trimestre} ${m.bc.annee} · commandé ${m.totaux.commande.toLocaleString('fr-FR')} L · ` +
      `chargé ${m.totaux.charge.toLocaleString('fr-FR')} L · livré ${m.totaux.livreTotal.toLocaleString('fr-FR')} L · ` +
      `écart non expliqué ${m.totaux.ecartNonExplique.toLocaleString('fr-FR')} L`
    );
  } catch (err) { next(err); }
}

export async function getManquantsLivraison(req: Request, res: Response, next: NextFunction) {
  try {
    const [data, pilotage] = await Promise.all([
      computeManquants(manquantsFilter(req)),
      computePilotageBL(),
    ]);
    // lignesEnRetard sert au job d'alerte ; on ne l'expose pas dans l'API.
    const { lignesEnRetard: _omit, ...rest } = data;
    res.json({ success: true, data: { ...rest, pilotage } });
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
          { header: 'Sur-livré (L)', key: 'surLivre', width: 14 },
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
          { header: 'Sur-livré (L)', key: 'surLivre', width: 14 },
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
          { header: 'Sur-chargé (L)', key: 'surCharge', width: 16 },
        ],
        rows: m.parMois as unknown as Record<string, unknown>[],
      },
      {
        name: 'Par chauffeur',
        columns: [
          { header: 'Chauffeur', key: 'libelle', width: 26 },
          { header: 'Chargé (L)', key: 'charge', width: 12 },
          { header: 'Distribué (L)', key: 'distribue', width: 14 },
          { header: 'Manquant (L)', key: 'manquant', width: 14 },
          { header: 'Taux manquant (%)', key: 'tauxManquantPct', width: 18 },
          { header: 'Chargements', key: 'nbBl', width: 12 },
          { header: 'dont en écart', key: 'nbBlEcart', width: 14 },
        ],
        rows: m.parChauffeur as unknown as Record<string, unknown>[],
      },
      {
        name: 'Par vehicule',
        columns: [
          { header: 'Camion', key: 'libelle', width: 16 },
          { header: 'Chargé (L)', key: 'charge', width: 12 },
          { header: 'Distribué (L)', key: 'distribue', width: 14 },
          { header: 'Manquant (L)', key: 'manquant', width: 14 },
          { header: 'Taux manquant (%)', key: 'tauxManquantPct', width: 18 },
          { header: 'Chargements', key: 'nbBl', width: 12 },
          { header: 'dont en écart', key: 'nbBlEcart', width: 14 },
        ],
        rows: m.parVehicule as unknown as Record<string, unknown>[],
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
          { header: 'Sur-chargé (L)', key: 'surCharge', width: 16 },
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
    // Un BC clôturé ou annulé n'accepte plus de chargement : sans ce contrôle,
    // un BL retardataire saisi en mai repeuplait un T1 déjà arrêté et facturé,
    // et modifiait rétroactivement le manquant du trimestre.
    if (bc.statut !== 'OUVERT') {
      throw new AppError(
        `Le bon de commande ${bc.numero} est ${bc.statut.toLowerCase()} : il n'accepte plus de chargement.`,
        409
      );
    }

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
        // Les lignes DÉJÀ SOLDÉES restent proposées : un même camion peut
        // repasser sur un site dans la même tournée (plan réajusté en route,
        // cuve qui déborde au premier passage). Elles disparaissaient de la
        // liste, et le technicien n'avait plus que le dépotage « hors plan » —
        // qui laissait le BL non soldé et le site en manquant chaque nuit.
        statut: { in: ['PREVU', 'PARTIEL', 'LIVRE'] },
        // Un chargement clôturé, lui, est définitivement soldé.
        bonLivraison: { statut: { not: 'ANNULE' }, isBrouillon: false, dateCloture: null },
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
        chauffeur: { select: { nom: true } },
        transporteur: { select: { nom: true } },
        lignes: { include: { site: { select: { code: true, nom: true, region: true } } } },
      },
    });

    const rows: Record<string, unknown>[] = [];
    for (const bl of bls) {
      if (bl.lignes.length === 0) {
        rows.push({ bl: bl.numeroBL, bc: bl.bonCommande?.numero ?? '', mois: MOIS[bl.mois], annee: bl.annee, camion: bl.immatriculation, chauffeur: bl.chauffeur?.nom ?? '', transporteur: bl.transporteur?.nom ?? '', charge: n(bl.volumeChargeLitres), site: '', region: '', prevu: '', livre: '', statut: bl.statut });
        continue;
      }
      for (const l of bl.lignes) {
        rows.push({
          bl: bl.numeroBL,
          bc: bl.bonCommande?.numero ?? '',
          mois: MOIS[bl.mois],
          annee: bl.annee,
          camion: bl.immatriculation,
          chauffeur: bl.chauffeur?.nom ?? '',
          transporteur: bl.transporteur?.nom ?? '',
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
        { header: 'Chauffeur', key: 'chauffeur', width: 22 },
        { header: 'Transporteur', key: 'transporteur', width: 22 },
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
