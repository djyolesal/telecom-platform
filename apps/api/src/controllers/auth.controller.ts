import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../config/database';
import { redisClient } from '../config/redis';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';
import { auditLog } from '../services/audit.service';
import { sendEmail } from '../services/email.service';
import { logger } from '../utils/logger';

const SALT_ROUNDS = 12;
// Durée de vie du jeton d'accès. 15 min était trop court pour le terrain
// (le jeton expirait pendant une intervention et faisait échouer l'upload
// multipart des photos lors de la clôture). Configurable via JWT_EXPIRES_IN.
const ACCESS_TTL = env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'];
const REFRESH_TTL = '30d';
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

function signAccess(userId: string, role: string) {
  return jwt.sign({ sub: userId, role }, env.JWT_SECRET, { expiresIn: ACCESS_TTL });
}

function signRefresh(userId: string) {
  return jwt.sign({ sub: userId }, env.JWT_REFRESH_SECRET, { expiresIn: REFRESH_TTL });
}

/**
 * @swagger
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Connexion utilisateur
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: Tokens JWT retournés
 *       401:
 *         description: Identifiants invalides
 */
export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || !user.isActive) throw new AppError('Identifiants invalides', 401);

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      await auditLog(user.id, 'LOGIN', 'auth', undefined, { success: false }, req);
      throw new AppError('Identifiants invalides', 401);
    }

    const accessToken = signAccess(user.id, user.role);
    const refreshToken = signRefresh(user.id);

    // Stocker refresh token dans Redis
    await redisClient.setEx(`refresh:${user.id}`, REFRESH_TTL_SECONDS, refreshToken);

    // Mise à jour lastLoginAt
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    await auditLog(user.id, 'LOGIN', 'auth', undefined, { success: true }, req);

    res.json({
      success: true,
      data: {
        accessToken,
        refreshToken,
        user: {
          id: user.id, nom: user.nom, prenom: user.prenom,
          email: user.email, role: user.role, region: user.region,
        },
      },
    });
  } catch (err) { next(err); }
}

export async function logout(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    // Blacklister le token actuel
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      const decoded = jwt.decode(token) as { exp?: number };
      const ttl = decoded?.exp ? decoded.exp - Math.floor(Date.now() / 1000) : 900;
      if (ttl > 0) await redisClient.setEx(`blacklist:${token}`, ttl, '1');
    }
    // Supprimer refresh token
    await redisClient.del(`refresh:${userId}`);
    await auditLog(userId, 'LOGOUT', 'auth', undefined, {}, req);
    res.json({ success: true, message: 'Déconnecté' });
  } catch (err) { next(err); }
}

export async function refreshToken(req: Request, res: Response, next: NextFunction) {
  try {
    const { refreshToken: token } = req.body;
    if (!token) throw new AppError('Refresh token manquant', 400);

    let payload: { sub: string };
    try {
      payload = jwt.verify(token, env.JWT_REFRESH_SECRET) as { sub: string };
    } catch {
      throw new AppError('Refresh token invalide ou expiré', 401);
    }

    const stored = await redisClient.get(`refresh:${payload.sub}`);
    if (stored !== token) throw new AppError('Refresh token révoqué', 401);

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) throw new AppError('Utilisateur introuvable', 401);

    const newAccess = signAccess(user.id, user.role);
    const newRefresh = signRefresh(user.id);

    await redisClient.setEx(`refresh:${user.id}`, REFRESH_TTL_SECONDS, newRefresh);

    res.json({ success: true, data: { accessToken: newAccess, refreshToken: newRefresh } });
  } catch (err) { next(err); }
}

export async function getMe(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { id: true, nom: true, prenom: true, email: true, telephone: true, role: true, region: true, lastLoginAt: true },
    });
    res.json({ success: true, data: user });
  } catch (err) { next(err); }
}

export async function updatePassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw new AppError('Utilisateur introuvable', 404);

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new AppError('Mot de passe actuel incorrect', 400);

    const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hash } });

    // Invalider tous les tokens existants
    await redisClient.del(`refresh:${user.id}`);
    await auditLog(user.id, 'UPDATE', 'users', user.id, { field: 'password' }, req);

    res.json({ success: true, message: 'Mot de passe mis à jour' });
  } catch (err) { next(err); }
}

export async function updateFcmToken(req: Request, res: Response, next: NextFunction) {
  try {
    const { token } = req.body;
    await prisma.user.update({ where: { id: req.user!.id }, data: { fcmToken: token } });
    res.json({ success: true });
  } catch (err) { next(err); }
}

const RESET_TTL_SECONDS = 60 * 60; // 1 heure

/**
 * @swagger
 * /auth/forgot-password:
 *   post:
 *     tags: [Auth]
 *     summary: Demande de réinitialisation de mot de passe (envoi email)
 */
export async function forgotPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { email } = req.body;
    const user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase() } });

    // Réponse identique que l'email existe ou non (anti-énumération)
    if (user && user.isActive) {
      const token = crypto.randomBytes(32).toString('hex');
      await redisClient.setEx(`reset:${token}`, RESET_TTL_SECONDS, user.id);
      const link = `${env.APP_URL}/reset-password?token=${token}`;
      await sendEmail({
        to: user.email,
        subject: 'Réinitialisation de votre mot de passe E&M OpS',
        html: `<p>Bonjour ${user.prenom},</p><p>Pour réinitialiser votre mot de passe, cliquez sur ce lien (valable 1 h) :</p><p><a href="${link}">${link}</a></p><p>Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>`,
      });
      logger.info(`[auth] Lien de réinitialisation envoyé à ${user.email}`);
    }

    res.json({ success: true, message: 'Si ce compte existe, un email de réinitialisation a été envoyé.' });
  } catch (err) { next(err); }
}

/**
 * @swagger
 * /auth/reset-password:
 *   post:
 *     tags: [Auth]
 *     summary: Réinitialise le mot de passe à partir du token reçu par email
 */
export async function resetPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) throw new AppError('Token et nouveau mot de passe requis', 400);
    if (String(newPassword).length < 8) throw new AppError('Mot de passe trop court (min 8 caractères)', 400);

    const userId = await redisClient.get(`reset:${token}`);
    if (!userId) throw new AppError('Token invalide ou expiré', 400);

    const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: hash } });

    await redisClient.del(`reset:${token}`);
    await redisClient.del(`refresh:${userId}`);
    await auditLog(userId, 'UPDATE', 'users', userId, { field: 'password_reset' }, req);

    res.json({ success: true, message: 'Mot de passe réinitialisé avec succès' });
  } catch (err) { next(err); }
}
