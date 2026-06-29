import { Request, Response, NextFunction } from 'express';
import { parseISO } from 'date-fns';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { paginate } from '../utils/paginator';
import { auditLog } from '../services/audit.service';
import { buildXlsx, setXlsxHeaders } from '../utils/excel';
import { clearMemo } from '../utils/memo';
import { expectedGasoilGE, analyseGasoilCoherence, analyseLivraison } from '../utils/energy';
import { getNum } from '../services/settings.service';
import { publicFileUrl } from '../services/storage.service';
import { io } from '../server';

/**
 * Dérive volume livré et stock après dépotage à partir des jauges.
 * Nouveau modèle : le terrain saisit la jauge AVANT et APRÈS → le volume livré est
 * déduit (stockApres − stockAvant). Repli (anciens clients) : volumeLitres direct.
 */
function deriveVolume(data: Record<string, any>) {
  const stockAvant = data.stockAvantLitres != null ? Number(data.stockAvantLitres) : null;
  const stockApresIn = data.stockApresLitres != null ? Number(data.stockApresLitres) : null;

  let volume: number;
  if (stockAvant != null && stockApresIn != null) {
    volume = Math.max(0, stockApresIn - stockAvant); // dérivé de la jauge
  } else {
    volume = Number(data.volumeLitres) || 0; // repli ancien client
  }

  const stockApres = stockApresIn != null ? stockApresIn : stockAvant != null ? stockAvant + volume : null;

  return { volume, stockAvant, stockApres };
}

/** Heures GE valides rattachées à des groupes du site (anti-corruption croisée). */
function parseHeuresGE(raw: unknown, siteGroupeIds: Set<string>) {
  if (!Array.isArray(raw)) return [] as { groupeId: string; indexHeuresGE: number }[];
  return raw
    .map((h: any) => ({
      groupeId: h?.groupeId != null ? String(h.groupeId) : '',
      indexHeuresGE: Number(h?.indexHeuresGE),
    }))
    .filter((h) => h.groupeId && siteGroupeIds.has(h.groupeId) && Number.isFinite(h.indexHeuresGE) && h.indexHeuresGE >= 0);
}

/**
 * Réconciliation carburant au dépotage : compare le volume jauge à l'annoncé (BL)
 * et la baisse de cuve depuis le dépotage précédent au gasoil attendu (heures × kVA).
 */
async function reconcileDepotage(opts: {
  siteId: string;
  stockAvant: number | null;
  volumeReel: number;
  volumeAnnonce: number | null;
  heuresGE: { groupeId: string; indexHeuresGE: number }[];
  groupes: { id: string; puissanceKva: any; statut: string }[];
}) {
  const { siteId, stockAvant, volumeReel, volumeAnnonce, heuresGE, groupes } = opts;
  const seuilLivPct = getNum('carburant.seuilEcartLivraisonPct', 5);
  const seuilConsoPct = getNum('maintenance.seuilEcartGasoilPct', 25);

  // Écart de livraison : jauge réelle vs annoncé (BL/bordereau).
  const ecartLivraisonLitres = volumeAnnonce != null ? Math.round((volumeReel - volumeAnnonce) * 100) / 100 : null;
  const analyseLiv = analyseLivraison({ volumeReel, volumeAnnonce, seuilPct: seuilLivPct });

  // Écart de conso : baisse de cuve depuis le dépotage précédent vs gasoil attendu.
  const prev = await prisma.depotage.findFirst({
    where: { siteId, stockApresLitres: { not: null } },
    orderBy: { dateDepotage: 'desc' },
    include: { heuresGE: true },
  });

  let attendu = 0;
  let hasHeures = false;
  if (prev) {
    for (const cur of heuresGE) {
      const g = groupes.find((x) => x.id === cur.groupeId);
      const prevH = prev.heuresGE.find((h) => h.groupeId === cur.groupeId);
      if (!g || !prevH) continue;
      const delta = cur.indexHeuresGE - Number(prevH.indexHeuresGE);
      if (delta > 0) {
        attendu += expectedGasoilGE(Number(g.puissanceKva), g.statut, delta);
        hasHeures = true;
      }
    }
  }

  const consomme = prev && stockAvant != null ? Number(prev.stockApresLitres) - stockAvant : null;
  const ecartConsoLitres = consomme != null && hasHeures ? Math.round((consomme - attendu) * 100) / 100 : null;
  const analyseConso = analyseGasoilCoherence({ consomme, attendu, hasHeures, seuilPct: seuilConsoPct });

  const analyseDepotage = [analyseLiv, analyseConso].filter(Boolean).join('\n') || null;

  return {
    volumeAnnonceLitres: volumeAnnonce,
    gasoilAttenduLitres: hasHeures ? Math.round(attendu * 100) / 100 : null,
    ecartConsoLitres,
    ecartLivraisonLitres,
    analyseDepotage,
  };
}

/**
 * Recalcule l'état d'une ligne de plan de livraison à partir des dépotages réels
 * qui lui sont rattachés (volume livré cumulé + statut PREVU/PARTIEL/LIVRE).
 */
async function syncLigneLivraison(ligneLivraisonId: string | null | undefined) {
  if (!ligneLivraisonId) return;
  const ligne = await prisma.ligneLivraison.findUnique({
    where: { id: ligneLivraisonId },
    include: { depotages: { select: { volumeLitres: true } } },
  });
  if (!ligne) return;
  const livre = ligne.depotages.reduce((s, d) => s + Number(d.volumeLitres), 0);
  const prevu = Number(ligne.volumePrevuLitres);
  const statut = livre <= 0 ? 'PREVU' : livre + 0.5 >= prevu ? 'LIVRE' : 'PARTIEL';
  await prisma.ligneLivraison.update({
    where: { id: ligne.id },
    data: { volumeLivreLitres: livre, statut },
  });
}

export async function getDepotages(req: Request, res: Response, next: NextFunction) {
  try {
    const { site_id, fournisseur, date_debut, date_fin, page = '1', limit = '20' } =
      req.query as Record<string, string>;

    const where: Record<string, unknown> = {};
    if (site_id) where.siteId = site_id;
    if (fournisseur) where.fournisseur = { contains: fournisseur, mode: 'insensitive' };
    if (date_debut || date_fin) {
      where.dateDepotage = {
        ...(date_debut ? { gte: parseISO(date_debut) } : {}),
        ...(date_fin ? { lte: parseISO(date_fin) } : {}),
      };
    }

    const { data, meta } = await paginate(
      prisma.depotage,
      {
        where,
        orderBy: { dateDepotage: 'desc' },
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

export async function getDepotageById(req: Request, res: Response, next: NextFunction) {
  try {
    const depotage = await prisma.depotage.findUnique({
      where: { id: req.params.id },
      include: {
        site: true,
        technicien: { select: { nom: true, prenom: true } },
        heuresGE: { include: { groupe: { select: { numero: true, puissanceKva: true, statut: true } } } },
      },
    });
    if (!depotage) throw new AppError('Dépotage introuvable', 404);
    // Photos rattachées (modèle générique entityType/entityId) → URL recalculée depuis MinIO.
    const photos = await prisma.photo.findMany({
      where: { entityType: 'depotage', entityId: depotage.id },
      orderBy: { createdAt: 'asc' },
    });
    const data = {
      ...depotage,
      photos: photos.map((p) => ({ ...p, url: p.minioKey ? publicFileUrl(p.minioKey) : p.url })),
    };
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function createDepotage(req: Request, res: Response, next: NextFunction) {
  try {
    // Liste blanche des champs acceptés (évite le mass-assignment : technicienId/isSynced/etc.).
    const b = req.body as Record<string, unknown>;
    const siteId = String(b.siteId ?? '');
    if (!siteId) throw new AppError('Site requis', 400);
    const ligneLivraisonId = b.ligneLivraisonId ? String(b.ligneLivraisonId) : null;

    // Une ligne de plan ciblée doit appartenir AU MÊME site (anti-corruption croisée).
    if (ligneLivraisonId) {
      const ligne = await prisma.ligneLivraison.findUnique({ where: { id: ligneLivraisonId }, select: { siteId: true } });
      if (!ligne) throw new AppError('Ligne de livraison introuvable', 404);
      if (ligne.siteId !== siteId) throw new AppError('La ligne de plan ne correspond pas au site du dépotage', 400);
    }

    const { volume, stockAvant, stockApres } = deriveVolume(b);

    // GE actifs du site → validation des heures saisies + réconciliation conso.
    const groupes = await prisma.groupeElectrogene.findMany({
      where: { siteId, isActive: true },
      select: { id: true, puissanceKva: true, statut: true },
    });
    const heuresGE = parseHeuresGE(b.heuresGE, new Set(groupes.map((g) => g.id)));
    const volumeAnnonce = b.volumeAnnonceLitres != null ? Number(b.volumeAnnonceLitres) : null;

    const recon = await reconcileDepotage({
      siteId,
      stockAvant,
      volumeReel: volume,
      volumeAnnonce: Number.isFinite(volumeAnnonce as number) ? volumeAnnonce : null,
      heuresGE,
      groupes,
    });

    const photosIn = (b.photos as { url?: string; key?: string }[] | undefined) ?? [];

    // Dépotage + photos écrits de façon ATOMIQUE : si l'insertion des photos
    // échoue, le dépotage est annulé (plus de « sauvé mais erreur 400 » →
    // plus de doublons au réessai de la sync).
    const depotage = await prisma.$transaction(async (tx) => {
      const dep = await tx.depotage.create({
        data: {
          siteId,
          ligneLivraisonId,
          dateDepotage: b.dateDepotage ? new Date(String(b.dateDepotage)) : new Date(),
          technicienId: req.user!.id, // toujours l'utilisateur courant, jamais le client
          volumeLitres: volume,
          stockAvantLitres: stockAvant,
          fournisseur: b.fournisseur ? String(b.fournisseur) : null,
          numeroBonLivraison: b.numeroBonLivraison ? String(b.numeroBonLivraison) : null,
          prixLitre: b.prixLitre != null ? Number(b.prixLitre) : null,
          observations: b.observations ? String(b.observations) : null,
          latitude: b.latitude != null ? Number(b.latitude) : null,
          longitude: b.longitude != null ? Number(b.longitude) : null,
          nomChauffeur: b.nomChauffeur ? String(b.nomChauffeur) : null,
          signatureChauffeurPath: b.signatureChauffeurPath ? String(b.signatureChauffeurPath) : null,
          nomAgentSecurite: b.nomAgentSecurite ? String(b.nomAgentSecurite) : null,
          signatureAgentSecuritePath: b.signatureAgentSecuritePath ? String(b.signatureAgentSecuritePath) : null,
          signatureTechnicienPath: b.signatureTechnicienPath ? String(b.signatureTechnicienPath) : null,
          bonLivraisonPath: b.bonLivraisonPath ? String(b.bonLivraisonPath) : null,
          stockApresLitres: stockApres,
          volumeAnnonceLitres: recon.volumeAnnonceLitres,
          gasoilAttenduLitres: recon.gasoilAttenduLitres,
          ecartConsoLitres: recon.ecartConsoLitres,
          ecartLivraisonLitres: recon.ecartLivraisonLitres,
          analyseDepotage: recon.analyseDepotage,
          heuresGE: { create: heuresGE.map((h) => ({ groupeId: h.groupeId, indexHeuresGE: h.indexHeuresGE })) },
        },
        include: { site: { select: { code: true, nom: true } } },
      });

      // Photos des travaux de dépotage (uploadées par la sync → clés MinIO).
      const photosData = photosIn
        .filter((p) => p && p.key)
        .map((p) => ({ entityType: 'depotage', entityId: dep.id, url: p.url ?? '', minioKey: p.key! }));
      if (photosData.length) await tx.photo.createMany({ data: photosData });

      return dep;
    });

    await syncLigneLivraison(depotage.ligneLivraisonId);
    clearMemo(); // nouvelles données → invalide manquants/forecast mémoïsés
    await auditLog(req.user!.id, 'CREATE', 'depotages', depotage.id, req.body, req);
    io.of('/supervision').emit('stock:updated', {
      siteId: depotage.siteId,
      siteCode: depotage.site?.code,
      stockApresLitres: stockApres,
      volumeLitres: Number(depotage.volumeLitres),
    });

    res.status(201).json({ success: true, data: depotage });
  } catch (err) { next(err); }
}

export async function updateDepotage(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.depotage.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Dépotage introuvable', 404);

    const { site: _s, technicien: _t, heuresGE: _h, prixLitre: _p, coutTotal: _c, ...data } = req.body;
    const { volume, stockApres } = deriveVolume({ ...existing, ...data });
    if (data.dateDepotage) data.dateDepotage = new Date(data.dateDepotage);

    const updated = await prisma.depotage.update({
      where: { id: req.params.id },
      data: { ...data, volumeLitres: volume, stockApresLitres: stockApres },
    });
    // Re-synchronise la (ou les) ligne(s) de plan impactée(s).
    await syncLigneLivraison(existing.ligneLivraisonId);
    if (updated.ligneLivraisonId !== existing.ligneLivraisonId) await syncLigneLivraison(updated.ligneLivraisonId);
    clearMemo();
    await auditLog(req.user!.id, 'UPDATE', 'depotages', existing.id, data, req);
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

export async function deleteDepotage(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.depotage.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Dépotage introuvable', 404);
    await prisma.depotage.delete({ where: { id: req.params.id } });
    await syncLigneLivraison(existing.ligneLivraisonId);
    clearMemo();
    await auditLog(req.user!.id, 'DELETE', 'depotages', existing.id, {}, req);
    res.json({ success: true, message: 'Dépotage supprimé' });
  } catch (err) { next(err); }
}

export async function exportDepotages(req: Request, res: Response, next: NextFunction) {
  try {
    const { site_id, fournisseur } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (site_id) where.siteId = site_id;
    if (fournisseur) where.fournisseur = { contains: fournisseur, mode: 'insensitive' };

    const rows = await prisma.depotage.findMany({
      where,
      orderBy: { dateDepotage: 'desc' },
      include: { site: { select: { code: true } } },
    });

    const buffer = await buildXlsx(
      'Depotages',
      [
        { header: 'Site', key: 'site', width: 16 },
        { header: 'Date', key: 'date', width: 18 },
        { header: 'Volume livré (L)', key: 'volume', width: 14 },
        { header: 'Volume annoncé (L)', key: 'annonce', width: 16 },
        { header: 'Écart livraison (L)', key: 'ecartLiv', width: 16 },
        { header: 'Stock après (L)', key: 'stockApres', width: 14 },
        { header: 'Fournisseur', key: 'fournisseur', width: 20 },
        { header: 'Bon livraison', key: 'bl', width: 18 },
      ],
      rows.map((d) => ({
        site: d.site?.code ?? '',
        date: d.dateDepotage.toLocaleString('fr-FR'),
        volume: Number(d.volumeLitres),
        annonce: d.volumeAnnonceLitres != null ? Number(d.volumeAnnonceLitres) : '',
        ecartLiv: d.ecartLivraisonLitres != null ? Number(d.ecartLivraisonLitres) : '',
        stockApres: d.stockApresLitres != null ? Number(d.stockApresLitres) : '',
        fournisseur: d.fournisseur ?? '',
        bl: d.numeroBonLivraison ?? '',
      }))
    );

    await auditLog(req.user!.id, 'EXPORT', 'depotages', undefined, { count: rows.length }, req);
    setXlsxHeaders(res, 'depotages.xlsx');
    res.send(buffer);
  } catch (err) { next(err); }
}
