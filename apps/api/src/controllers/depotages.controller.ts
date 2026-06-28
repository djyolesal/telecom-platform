import { Request, Response, NextFunction } from 'express';
import { parseISO } from 'date-fns';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { paginate } from '../utils/paginator';
import { auditLog } from '../services/audit.service';
import { buildXlsx, setXlsxHeaders } from '../utils/excel';
import { clearMemo } from '../utils/memo';
import { io } from '../server';

/** Calcule coût total et stock après dépotage à partir des entrées. */
function computeDepotage(data: Record<string, any>) {
  const volume = Number(data.volumeLitres) || 0;
  const prix = data.prixLitre != null ? Number(data.prixLitre) : null;
  const stockAvant = data.stockAvantLitres != null ? Number(data.stockAvantLitres) : null;

  const coutTotal = prix != null ? Math.round(volume * prix) : data.coutTotal ?? null;
  const stockApres =
    data.stockApresLitres != null
      ? Number(data.stockApresLitres)
      : stockAvant != null
        ? stockAvant + volume
        : null;

  return { coutTotal, stockApres };
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
      include: { site: true, technicien: { select: { nom: true, prenom: true } } },
    });
    if (!depotage) throw new AppError('Dépotage introuvable', 404);
    res.json({ success: true, data: depotage });
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

    const { coutTotal, stockApres } = computeDepotage(b);
    const depotage = await prisma.depotage.create({
      data: {
        siteId,
        ligneLivraisonId,
        dateDepotage: b.dateDepotage ? new Date(String(b.dateDepotage)) : new Date(),
        technicienId: req.user!.id, // toujours l'utilisateur courant, jamais le client
        volumeLitres: Number(b.volumeLitres) || 0,
        stockAvantLitres: b.stockAvantLitres != null ? Number(b.stockAvantLitres) : null,
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
        coutTotal,
        stockApresLitres: stockApres,
      },
      include: { site: { select: { code: true, nom: true } } },
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

    const { site: _s, technicien: _t, ...data } = req.body;
    const { coutTotal, stockApres } = computeDepotage({ ...existing, ...data });
    if (data.dateDepotage) data.dateDepotage = new Date(data.dateDepotage);

    const updated = await prisma.depotage.update({
      where: { id: req.params.id },
      data: { ...data, coutTotal, stockApresLitres: stockApres },
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
        { header: 'Volume (L)', key: 'volume', width: 12 },
        { header: 'Stock après (L)', key: 'stockApres', width: 14 },
        { header: 'Fournisseur', key: 'fournisseur', width: 20 },
        { header: 'Bon livraison', key: 'bl', width: 18 },
        { header: 'Prix/L', key: 'prix', width: 10 },
        { header: 'Coût total', key: 'cout', width: 14 },
      ],
      rows.map((d) => ({
        site: d.site?.code ?? '',
        date: d.dateDepotage.toLocaleString('fr-FR'),
        volume: Number(d.volumeLitres),
        stockApres: d.stockApresLitres != null ? Number(d.stockApresLitres) : '',
        fournisseur: d.fournisseur ?? '',
        bl: d.numeroBonLivraison ?? '',
        prix: d.prixLitre != null ? Number(d.prixLitre) : '',
        cout: d.coutTotal != null ? Number(d.coutTotal) : '',
      }))
    );

    await auditLog(req.user!.id, 'EXPORT', 'depotages', undefined, { count: rows.length }, req);
    setXlsxHeaders(res, 'depotages.xlsx');
    res.send(buffer);
  } catch (err) { next(err); }
}
