import { publicFileUrl } from '../services/storage.service';
import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { paginate } from '../utils/paginator';
import { auditLog } from '../services/audit.service';

/** Rapproche les sites dont la société de gardiennage (texte libre) correspond
 *  au nom du prestataire (comparaison normalisée) — sans écraser un lien déjà posé. */
async function rapprocherSitesGardiennage(prestataireId: string, nom: string): Promise<void> {
  const normNom = (x: string) => x.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]/g, '');
  const cible = normNom(nom);
  if (!cible) return;
  const sites = await prisma.site.findMany({
    where: { gardiennagePrestataireId: null, societeGardiennage: { not: null } },
    select: { id: true, societeGardiennage: true },
  });
  const ids = sites.filter((s) => normNom(s.societeGardiennage!) === cible).map((s) => s.id);
  if (ids.length) await prisma.site.updateMany({ where: { id: { in: ids } }, data: { gardiennagePrestataireId: prestataireId } });
}

/**
 * `logoPath` est une clé d'objet MinIO fournie par le client et relue telle
 * quelle à la génération des fiches : sans contrainte, on pouvait pointer
 * n'importe quel objet du bucket (photos d'intervention, pièces jointes) et
 * l'exfiltrer dans un classeur Excel.
 */
function logoValide(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const k = String(v);
  if (!/^logos\/[A-Za-z0-9._-]+\.(png|jpe?g|gif)$/i.test(k)) {
    throw new AppError('Chemin de logo invalide (attendu : logos/<fichier>.png|jpg|gif)', 400);
  }
  return k;
}

export async function getPrestataires(req: Request, res: Response, next: NextFunction) {
  try {
    const { search, is_active, is_transporteur, is_gardiennage, page = '1', limit = '20' } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (is_active != null) where.isActive = is_active === 'true';
    if (is_transporteur != null) where.isTransporteur = is_transporteur === 'true';
    if (is_gardiennage != null) where.isGardiennage = is_gardiennage === 'true';
    if (search) where.OR = [
      { nom: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];

    const { data, meta } = await paginate(
      prisma.prestataire,
      { where, orderBy: { nom: 'asc' }, include: { _count: { select: { assignments: true, sitesGardes: true } } } },
      { page: parseInt(page), limit: parseInt(limit) }
    );
    // Logo : URL signée (le bucket n'est plus lisible par simple chemin).
    const avecLogo = (data as Array<{ logoPath: string | null }>).map((p) => ({
      ...p, logoUrl: p.logoPath ? publicFileUrl(p.logoPath) : null,
    }));
    res.json({ success: true, data: avecLogo, meta });
  } catch (err) { next(err); }
}

export async function getPrestataireById(req: Request, res: Response, next: NextFunction) {
  try {
    const prestataire = await prisma.prestataire.findUnique({
      where: { id: req.params.id },
      include: {
        assignments: {
          include: { lot: { select: { id: true, code: true, nom: true, region: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!prestataire) throw new AppError('Prestataire introuvable', 404);
    res.json({ success: true, data: prestataire });
  } catch (err) { next(err); }
}

export async function createPrestataire(req: Request, res: Response, next: NextFunction) {
  try {
    const { nom, email, adresse, rccm, nif, contactCommercial, contactTechnique, logoPath, isTransporteur, isGardiennage } = req.body;
    if (!nom) throw new AppError('Le nom est requis', 400);
    const prestataire = await prisma.prestataire.create({ data: { nom, email, adresse, rccm, nif, contactCommercial, contactTechnique, logoPath: logoValide(logoPath) ?? null, isTransporteur: !!isTransporteur, isGardiennage: !!isGardiennage } });
    if (prestataire.isGardiennage) await rapprocherSitesGardiennage(prestataire.id, prestataire.nom);
    await auditLog(req.user!.id, 'CREATE', 'prestataires', prestataire.id, { nom }, req);
    res.status(201).json({ success: true, data: prestataire });
  } catch (err) { next(err); }
}

export async function updatePrestataire(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.prestataire.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Prestataire introuvable', 404);
    const { nom, email, isActive, adresse, rccm, nif, contactCommercial, contactTechnique, logoPath, isTransporteur, isGardiennage } = req.body;
    const updated = await prisma.prestataire.update({
      where: { id: req.params.id },
      data: { nom, email, isActive, adresse, rccm, nif, contactCommercial, contactTechnique, logoPath: logoValide(logoPath), ...(isTransporteur !== undefined ? { isTransporteur: !!isTransporteur } : {}), ...(isGardiennage !== undefined ? { isGardiennage: !!isGardiennage } : {}) },
    });
    if (updated.isGardiennage) await rapprocherSitesGardiennage(updated.id, updated.nom);
    await auditLog(req.user!.id, 'UPDATE', 'prestataires', existing.id, req.body, req);
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

export async function togglePrestataire(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.prestataire.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Prestataire introuvable', 404);
    const updated = await prisma.prestataire.update({
      where: { id: req.params.id },
      data: { isActive: !existing.isActive },
    });
    await auditLog(req.user!.id, 'UPDATE', 'prestataires', existing.id, { isActive: updated.isActive }, req);
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

export async function deletePrestataire(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.prestataire.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { assignments: true } } },
    });
    if (!existing) throw new AppError('Prestataire introuvable', 404);
    if (existing._count.assignments > 0) {
      throw new AppError('Impossible de supprimer : ce prestataire a des lots attribués. Désactivez-le plutôt.', 409);
    }
    await prisma.prestataire.delete({ where: { id: req.params.id } });
    await auditLog(req.user!.id, 'DELETE', 'prestataires', existing.id, {}, req);
    res.json({ success: true, message: 'Prestataire supprimé' });
  } catch (err) { next(err); }
}

// ── « Ma société » : fiche du prestataire de l'utilisateur connecté ─────────
// Le superviseur d'un prestataire complète et tient à jour les coordonnées de
// SA société (en-tête des fiches de validation PDF). Champs identitaires
// (nom, périmètres, statut) réservés au manager/admin.

const CHAMPS_REQUIS_SOCIETE = ['email', 'adresse', 'rccm', 'nif', 'contactCommercial', 'contactTechnique'] as const;

function champsManquants(p: Record<string, unknown>): string[] {
  return CHAMPS_REQUIS_SOCIETE.filter((k) => !String(p[k] ?? '').trim());
}

export async function getMaSociete(req: Request, res: Response, next: NextFunction) {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { prestataireId: true } });
    if (!me?.prestataireId) return res.json({ success: true, data: null }); // utilisateur interne
    const prestataire = await prisma.prestataire.findUnique({ where: { id: me.prestataireId } });
    if (!prestataire) return res.json({ success: true, data: null });
    const manquants = champsManquants(prestataire as unknown as Record<string, unknown>);
    res.json({ success: true, data: { ...prestataire, logoUrl: prestataire.logoPath ? publicFileUrl(prestataire.logoPath) : null, ficheComplete: manquants.length === 0, champsManquants: manquants } });
  } catch (err) { next(err); }
}

export async function updateMaSociete(req: Request, res: Response, next: NextFunction) {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { prestataireId: true } });
    if (!me?.prestataireId) throw new AppError("Votre compte n'est rattaché à aucun prestataire.", 403);
    // Liste blanche : coordonnées uniquement (jamais nom/isActive/périmètres).
    const b = req.body as Record<string, unknown>;
    const data: Record<string, string | null> = {};
    for (const k of ['email', 'adresse', 'rccm', 'nif', 'contactCommercial', 'contactTechnique', 'logoPath'] as const) {
      if (typeof b[k] === 'string') data[k] = (b[k] as string).trim() || null;
    }
    if (!Object.keys(data).length) throw new AppError('Aucun champ modifiable fourni.', 400);
    const updated = await prisma.prestataire.update({ where: { id: me.prestataireId }, data });
    await auditLog(req.user!.id, 'UPDATE', 'prestataires', updated.id, { maSociete: data }, req);
    const manquants = champsManquants(updated as unknown as Record<string, unknown>);
    res.json({ success: true, data: { ...updated, ficheComplete: manquants.length === 0, champsManquants: manquants } });
  } catch (err) { next(err); }
}
