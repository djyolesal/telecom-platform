import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { redisClient } from '../config/redis';
import { env } from '../config/env';
import { paginate } from '../utils/paginator';
import { auditLog } from '../services/audit.service';
import { sendEmail } from '../services/email.service';
import { sendTabular, EXPORT_MAX } from '../utils/exporter';

const SALT_ROUNDS = 12;
const SAFE_SELECT = {
  id: true, nom: true, prenom: true, email: true, telephone: true,
  role: true, region: true, isActive: true, lastLoginAt: true, createdAt: true,
  prestataireId: true, equipe: true,
  appareilLabel: true, appareilLieLe: true,
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
    // Aucun mot de passe en clair par email : le compte naît avec un secret
    // aléatoire inutilisable, et l'utilisateur définit le sien via un lien à
    // usage unique. (Un mot de passe explicite fourni par l'admin reste honoré.)
    const plain = password || crypto.randomBytes(32).toString('hex');
    const passwordHash = await bcrypt.hash(plain, SALT_ROUNDS);

    const user = await prisma.user.create({
      data: { ...rest, email: String(email).toLowerCase(), passwordHash },
      select: SAFE_SELECT,
    });

    await auditLog(req.user!.id, 'CREATE', 'users', user.id, { email, role: rest.role }, req);
    if (password) {
      await sendEmail({
        to: user.email,
        subject: 'Votre compte E&M OpS',
        html: `<p>Bonjour ${user.prenom},</p><p>Votre compte a été créé. Connectez-vous et changez votre mot de passe dès la première connexion.</p>`,
      });
    } else {
      const token = crypto.randomBytes(32).toString('hex');
      await redisClient.setEx(`reset:${token}`, 60 * 60, user.id);
      const link = `${env.APP_URL}/reset-password?token=${token}`;
      await sendEmail({
        to: user.email,
        subject: 'Votre compte E&M OpS — définir votre mot de passe',
        html: `<p>Bonjour ${user.prenom},</p><p>Votre compte a été créé. Cliquez sur ce lien (valable 1 h) pour définir votre mot de passe :</p><p><a href="${link}">${link}</a></p>`,
      });
    }

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

    // Envoi d'un LIEN de réinitialisation à usage unique (valable 1 h) — jamais un
    // mot de passe en clair par email : l'utilisateur choisit lui-même le sien.
    const token = crypto.randomBytes(32).toString('hex');
    await redisClient.setEx(`reset:${token}`, 60 * 60, existing.id);
    const link = `${env.APP_URL}/reset-password?token=${token}`;
    await auditLog(req.user!.id, 'UPDATE', 'users', existing.id, { field: 'password_reset_link' }, req);
    await sendEmail({
      to: existing.email,
      subject: 'Réinitialisation de votre mot de passe E&M OpS',
      html: `<p>Bonjour ${existing.prenom},</p><p>Un administrateur a initié la réinitialisation de votre mot de passe. Cliquez sur ce lien (valable 1 h) pour en définir un nouveau :</p><p><a href="${link}">${link}</a></p>`,
    });

    res.json({ success: true, message: 'Lien de réinitialisation envoyé par email' });
  } catch (err) { next(err); }
}

export async function exportUsers(req: Request, res: Response, next: NextFunction) {
  try {
    const users = await prisma.user.findMany({ take: EXPORT_MAX, orderBy: { nom: 'asc' }, select: SAFE_SELECT });
    await auditLog(req.user!.id, 'EXPORT', 'users', undefined, { count: users.length }, req);

    const format = req.params.format || 'csv';
    if (format === 'csv') {
      const header = 'Nom;Prénom;Email;Téléphone;Rôle;Région;Actif;Dernière connexion';
      const lines = users.map((u) =>
        [u.nom, u.prenom, u.email, u.telephone ?? '', u.role, u.region ?? '',
          u.isActive ? 'Oui' : 'Non', u.lastLoginAt?.toISOString() ?? ''].join(';')
      );
      const csv = '﻿' + [header, ...lines].join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="utilisateurs.csv"');
      res.send(csv);
      return;
    }
    await sendTabular(res, format, 'utilisateurs', 'Utilisateurs', [{
      name: 'Utilisateurs',
      columns: [
        { header: 'Nom', key: 'nom', width: 18 },
        { header: 'Prénom', key: 'prenom', width: 16 },
        { header: 'Email', key: 'email', width: 26 },
        { header: 'Téléphone', key: 'telephone', width: 14 },
        { header: 'Rôle', key: 'role', width: 14 },
        { header: 'Région', key: 'region', width: 14 },
        { header: 'Actif', key: 'actif', width: 8 },
        { header: 'Dernière connexion', key: 'connexion', width: 18 },
      ],
      rows: users.map((u) => ({
        nom: u.nom,
        prenom: u.prenom,
        email: u.email,
        telephone: u.telephone ?? '',
        role: u.role,
        region: u.region ?? '',
        actif: u.isActive ? 'Oui' : 'Non',
        connexion: u.lastLoginAt ? u.lastLoginAt.toLocaleString('fr-FR') : '',
      })),
    }]);
  } catch (err) { next(err); }
}

/**
 * Délie l'appareil mobile d'un compte terrain (remplacement/perte de téléphone) :
 * le prochain login mobile du compte liera le nouvel appareil.
 */
export async function delierAppareil(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, appareilLabel: true } });
    if (!user) throw new AppError('Utilisateur introuvable', 404);
    await prisma.user.update({
      where: { id: user.id },
      data: { appareilId: null, appareilLabel: null, appareilLieLe: null },
    });
    await auditLog(req.user!.id, 'UPDATE', 'users', user.id, { action: 'delier_appareil', ancien: user.appareilLabel }, req);
    res.json({ success: true });
  } catch (err) { next(err); }
}
