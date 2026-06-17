import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { paginate } from '../utils/paginator';
import { auditLog } from '../services/audit.service';
import { sendEmail } from '../services/email.service';

const SALT_ROUNDS = 12;
const SAFE_SELECT = {
  id: true, nom: true, prenom: true, email: true, telephone: true,
  role: true, region: true, isActive: true, lastLoginAt: true, createdAt: true,
  prestataireId: true, equipe: true,
  prestataire: { select: { id: true, nom: true } },
};

export async function getUsers(req: Request, res: Response, next: NextFunction) {
  try {
    const { role, region, is_active, search, page = '1', limit = '20' } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (role) where.role = role;
    if (region) where.region = region;
    if (is_active != null) where.isActive = is_active === 'true';
    if (search) where.OR = [
      { nom: { contains: search, mode: 'insensitive' } },
      { prenom: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];

    const { data, meta } = await paginate(
      prisma.user,
      { where, orderBy: { nom: 'asc' }, select: SAFE_SELECT },
      { page: parseInt(page), limit: parseInt(limit) }
    );
    res.json({ success: true, data, meta });
  } catch (err) { next(err); }
}

export async function getUserById(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: SAFE_SELECT });
    if (!user) throw new AppError('Utilisateur introuvable', 404);
    res.json({ success: true, data: user });
  } catch (err) { next(err); }
}

export async function createUser(req: Request, res: Response, next: NextFunction) {
  try {
    const { password, email, ...rest } = req.body;
    const plain = password || crypto.randomBytes(6).toString('base64url');
    const passwordHash = await bcrypt.hash(plain, SALT_ROUNDS);

    const user = await prisma.user.create({
      data: { ...rest, email: String(email).toLowerCase(), passwordHash },
      select: SAFE_SELECT,
    });

    await auditLog(req.user!.id, 'CREATE', 'users', user.id, { email, role: rest.role }, req);
    await sendEmail({
      to: user.email,
      subject: 'Votre compte TélécomOps',
      html: `<p>Bonjour ${user.prenom},</p><p>Votre compte a été créé. Mot de passe provisoire : <b>${plain}</b></p><p>Merci de le changer dès votre première connexion.</p>`,
    });

    res.status(201).json({ success: true, data: user });
  } catch (err) { next(err); }
}

export async function updateUser(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Utilisateur introuvable', 404);

    const { password, passwordHash: _ph, email, ...data } = req.body;
    if (email) data.email = String(email).toLowerCase();
    if (password) data.passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const user = await prisma.user.update({ where: { id: req.params.id }, data, select: SAFE_SELECT });
    await auditLog(req.user!.id, 'UPDATE', 'users', existing.id, data, req);
    res.json({ success: true, data: user });
  } catch (err) { next(err); }
}

export async function deleteUser(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.params.id === req.user!.id) throw new AppError('Impossible de supprimer son propre compte', 400);
    const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Utilisateur introuvable', 404);
    // Désactivation (soft delete) pour préserver l'intégrité des historiques
    await prisma.user.update({ where: { id: req.params.id }, data: { isActive: false } });
    await auditLog(req.user!.id, 'DELETE', 'users', existing.id, {}, req);
    res.json({ success: true, message: 'Utilisateur désactivé' });
  } catch (err) { next(err); }
}

export async function toggleActive(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Utilisateur introuvable', 404);
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { isActive: !existing.isActive },
      select: SAFE_SELECT,
    });
    await auditLog(req.user!.id, 'UPDATE', 'users', existing.id, { isActive: user.isActive }, req);
    res.json({ success: true, data: user });
  } catch (err) { next(err); }
}

export async function resetUserPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Utilisateur introuvable', 404);

    const plain = crypto.randomBytes(6).toString('base64url');
    const passwordHash = await bcrypt.hash(plain, SALT_ROUNDS);
    await prisma.user.update({ where: { id: req.params.id }, data: { passwordHash } });

    await auditLog(req.user!.id, 'UPDATE', 'users', existing.id, { field: 'password_reset' }, req);
    await sendEmail({
      to: existing.email,
      subject: 'Réinitialisation de votre mot de passe TélécomOps',
      html: `<p>Bonjour ${existing.prenom},</p><p>Votre nouveau mot de passe provisoire : <b>${plain}</b></p>`,
    });

    res.json({ success: true, message: 'Mot de passe réinitialisé et envoyé par email' });
  } catch (err) { next(err); }
}

export async function exportUsers(req: Request, res: Response, next: NextFunction) {
  try {
    const users = await prisma.user.findMany({ orderBy: { nom: 'asc' }, select: SAFE_SELECT });
    const header = 'Nom;Prénom;Email;Téléphone;Rôle;Région;Actif;Dernière connexion';
    const lines = users.map((u) =>
      [u.nom, u.prenom, u.email, u.telephone ?? '', u.role, u.region ?? '',
        u.isActive ? 'Oui' : 'Non', u.lastLoginAt?.toISOString() ?? ''].join(';')
    );
    const csv = '﻿' + [header, ...lines].join('\n');

    await auditLog(req.user!.id, 'EXPORT', 'users', undefined, { count: users.length }, req);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="utilisateurs.csv"');
    res.send(csv);
  } catch (err) { next(err); }
}
