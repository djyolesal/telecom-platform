import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { auditLog } from '../services/audit.service';
import { paginate } from '../utils/paginator';
import { clearMemo } from '../utils/memo';
import { normaliserPlaque, plaqueUtilisable, normaliserNom, nomUtilisable } from '../utils/referentielTransport';

const n = (v: unknown): number => (v == null ? 0 : Number(v));

/**
 * Administration des référentiels VÉHICULE et CHAUFFEUR.
 *
 * Ces référentiels se peuplent tout seuls à l'usage (une plaque nomme un
 * camion, un nom nomme un chauffeur) : ces écrans servent à les ENRICHIR —
 * capacité de citerne (le seul moyen de détecter un volume chargé impossible),
 * téléphone et numéro de permis (joignabilité et litiges), rattachement au bon
 * transporteur, désactivation d'un camion sorti du parc.
 *
 * Un transporteur ne voit et ne modifie que SON parc ; il ne peut pas se
 * réaffecter un véhicule qui ne lui appartient pas.
 */

/** Prestataire de l'utilisateur courant (null pour les comptes internes). */
async function prestataireDe(userId: string): Promise<string | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { prestataireId: true } });
  return u?.prestataireId ?? null;
}

/** Portée de lecture/écriture : un transporteur est enfermé dans son parc. */
async function portee(req: Request): Promise<string | null> {
  if (req.user!.role !== 'TRANSPORTEUR') return null;
  const pid = await prestataireDe(req.user!.id);
  if (!pid) throw new AppError("Votre compte n'est rattaché à aucun transporteur", 403);
  return pid;
}

// ── Véhicules ───────────────────────────────────────────────────────────────

export async function getVehicules(req: Request, res: Response, next: NextFunction) {
  try {
    const mien = await portee(req);
    const where: Prisma.VehiculeWhereInput = {};
    if (mien) where.prestataireId = mien;
    else if (req.query.prestataire_id) where.prestataireId = String(req.query.prestataire_id);
    if (req.query.actifs === 'true') where.isActive = true;
    if (req.query.q) {
      // Recherche sur la forme normalisée : « TG 1234 AB » trouve « TG-1234-AB ».
      where.immatriculation = { contains: normaliserPlaque(req.query.q) };
    }

    const { data, meta } = await paginate(
      prisma.vehicule,
      {
        where,
        orderBy: { libelle: 'asc' },
        include: {
          prestataire: { select: { id: true, nom: true } },
          _count: { select: { bonsLivraison: true } },
        },
      },
      { page: parseInt(String(req.query.page ?? '1')), limit: parseInt(String(req.query.limit ?? '50')) }
    );
    res.json({ success: true, data, meta });
  } catch (err) { next(err); }
}

export async function createVehicule(req: Request, res: Response, next: NextFunction) {
  try {
    const mien = await portee(req);
    const { immatriculation, capaciteCiterneLitres, marque } = req.body;
    if (!plaqueUtilisable(immatriculation)) {
      throw new AppError('Immatriculation invalide (au moins 4 caractères, hors « À AFFECTER »).', 400);
    }
    const cap = capaciteCiterneLitres != null ? n(capaciteCiterneLitres) : null;
    if (cap != null && cap <= 0) throw new AppError('Capacité de citerne invalide.', 400);

    const v = await prisma.vehicule.create({
      data: {
        immatriculation: normaliserPlaque(immatriculation),
        libelle: String(immatriculation).trim().slice(0, 30),
        prestataireId: mien ?? (req.body.prestataireId ? String(req.body.prestataireId) : null),
        capaciteCiterneLitres: cap,
        marque: marque ? String(marque).slice(0, 60) : null,
      },
    });
    await auditLog(req.user!.id, 'CREATE', 'vehicules', v.id, req.body, req);
    clearMemo();
    res.status(201).json({ success: true, data: v });
  } catch (err) {
    next(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
      ? new AppError('Ce camion est déjà enregistré (même immatriculation).', 409)
      : err);
  }
}

export async function updateVehicule(req: Request, res: Response, next: NextFunction) {
  try {
    const mien = await portee(req);
    const existant = await prisma.vehicule.findUnique({ where: { id: req.params.id } });
    if (!existant) throw new AppError('Véhicule introuvable', 404);
    if (mien && existant.prestataireId !== mien) throw new AppError('Véhicule hors de votre parc.', 403);

    const data: Prisma.VehiculeUpdateInput = {};
    if (req.body.immatriculation != null) {
      if (!plaqueUtilisable(req.body.immatriculation)) throw new AppError('Immatriculation invalide.', 400);
      data.immatriculation = normaliserPlaque(req.body.immatriculation);
      data.libelle = String(req.body.immatriculation).trim().slice(0, 30);
    }
    if (req.body.capaciteCiterneLitres !== undefined) {
      const cap = req.body.capaciteCiterneLitres === null ? null : n(req.body.capaciteCiterneLitres);
      if (cap != null && cap <= 0) throw new AppError('Capacité de citerne invalide.', 400);
      data.capaciteCiterneLitres = cap;
    }
    if (req.body.marque !== undefined) data.marque = req.body.marque ? String(req.body.marque).slice(0, 60) : null;
    if (req.body.isActive != null) data.isActive = !!req.body.isActive;
    // Le rattachement à un transporteur reste une décision interne.
    if (req.body.prestataireId !== undefined && !mien) {
      data.prestataire = req.body.prestataireId ? { connect: { id: String(req.body.prestataireId) } } : { disconnect: true };
    }

    const v = await prisma.vehicule.update({ where: { id: existant.id }, data });
    await auditLog(req.user!.id, 'UPDATE', 'vehicules', v.id, req.body, req);
    clearMemo();
    res.json({ success: true, data: v });
  } catch (err) {
    next(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
      ? new AppError('Un autre camion porte déjà cette immatriculation.', 409)
      : err);
  }
}

// ── Chauffeurs ──────────────────────────────────────────────────────────────

export async function getChauffeurs(req: Request, res: Response, next: NextFunction) {
  try {
    const mien = await portee(req);
    const where: Prisma.ChauffeurWhereInput = {};
    if (mien) where.prestataireId = mien;
    else if (req.query.prestataire_id) where.prestataireId = String(req.query.prestataire_id);
    if (req.query.actifs === 'true') where.isActive = true;
    if (req.query.q) where.nomNormalise = { contains: normaliserNom(req.query.q) };

    const { data, meta } = await paginate(
      prisma.chauffeur,
      {
        where,
        orderBy: { nom: 'asc' },
        include: {
          prestataire: { select: { id: true, nom: true } },
          _count: { select: { bonsLivraison: true, depotages: true } },
        },
      },
      { page: parseInt(String(req.query.page ?? '1')), limit: parseInt(String(req.query.limit ?? '50')) }
    );
    res.json({ success: true, data, meta });
  } catch (err) { next(err); }
}

export async function createChauffeur(req: Request, res: Response, next: NextFunction) {
  try {
    const mien = await portee(req);
    const { nom, telephone, numeroPermis } = req.body;
    if (!nomUtilisable(nom)) throw new AppError('Nom du chauffeur requis.', 400);
    const prestataireId = mien ?? (req.body.prestataireId ? String(req.body.prestataireId) : null);

    // Doublon vérifié en amont : la contrainte unique ne couvre pas les
    // chauffeurs sans transporteur (PostgreSQL considère deux NULL distincts).
    const deja = await prisma.chauffeur.findFirst({
      where: { nomNormalise: normaliserNom(nom), prestataireId },
      select: { id: true, nom: true },
    });
    if (deja) throw new AppError(`Le chauffeur « ${deja.nom} » existe déjà.`, 409);

    const c = await prisma.chauffeur.create({
      data: {
        nom: String(nom).trim().slice(0, 100),
        nomNormalise: normaliserNom(nom),
        prestataireId,
        telephone: telephone ? String(telephone).slice(0, 30) : null,
        numeroPermis: numeroPermis ? String(numeroPermis).slice(0, 40) : null,
      },
    });
    await auditLog(req.user!.id, 'CREATE', 'chauffeurs', c.id, req.body, req);
    clearMemo();
    res.status(201).json({ success: true, data: c });
  } catch (err) { next(err); }
}

export async function updateChauffeur(req: Request, res: Response, next: NextFunction) {
  try {
    const mien = await portee(req);
    const existant = await prisma.chauffeur.findUnique({ where: { id: req.params.id } });
    if (!existant) throw new AppError('Chauffeur introuvable', 404);
    if (mien && existant.prestataireId !== mien) throw new AppError('Chauffeur hors de votre effectif.', 403);

    const data: Prisma.ChauffeurUpdateInput = {};
    if (req.body.nom != null) {
      if (!nomUtilisable(req.body.nom)) throw new AppError('Nom du chauffeur invalide.', 400);
      data.nom = String(req.body.nom).trim().slice(0, 100);
      data.nomNormalise = normaliserNom(req.body.nom);
    }
    if (req.body.telephone !== undefined) data.telephone = req.body.telephone ? String(req.body.telephone).slice(0, 30) : null;
    if (req.body.numeroPermis !== undefined) data.numeroPermis = req.body.numeroPermis ? String(req.body.numeroPermis).slice(0, 40) : null;
    if (req.body.isActive != null) data.isActive = !!req.body.isActive;
    if (req.body.prestataireId !== undefined && !mien) {
      data.prestataire = req.body.prestataireId ? { connect: { id: String(req.body.prestataireId) } } : { disconnect: true };
    }

    const c = await prisma.chauffeur.update({ where: { id: existant.id }, data });
    await auditLog(req.user!.id, 'UPDATE', 'chauffeurs', c.id, req.body, req);
    clearMemo();
    res.json({ success: true, data: c });
  } catch (err) {
    next(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
      ? new AppError('Un autre chauffeur porte déjà ce nom chez ce transporteur.', 409)
      : err);
  }
}
