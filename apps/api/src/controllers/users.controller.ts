import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { redisClient } from '../config/redis';
import { env } from '../config/env';
import { pick } from '../utils/pick';
import { paginate } from '../utils/paginator';
import { auditLog } from '../services/audit.service';
import { sendEmail } from '../services/email.service';
import { revoquerToutesSessions, revoquerSession } from '../services/session.service';
import { sendTabular, EXPORT_MAX } from '../utils/exporter';

const SALT_ROUNDS = 12;
const SAFE_SELECT = {
  id: true, nom: true, prenom: true, email: true, telephone: true,
  role: true, region: true, isActive: true, lastLoginAt: true, createdAt: true,
  prestataireId: true, equipe: true,
  appareilId: true, appareilLabel: true, appareilLieLe: true,
  appVersion: true, appVersionLe: true,
  prestataire: { select: { id: true, nom: true } },
};

/**
 * EMPREINTE D'APPAREIL : l'étiquette enregistrée à la liaison est le MODÈLE du
 * téléphone (« Samsung A14 »). Deux appareils identiques portaient donc le même
 * nom à l'écran alors que ce sont bien deux téléphones : on ne savait plus
 * lequel délier. Ces six caractères, dérivés de l'identifiant, les séparent.
 *
 * L'identifiant, lui, ne sort JAMAIS de l'API : il est la moitié secrète du
 * verrou d'appareil - le connaître, avec des identifiants volés, suffirait à se
 * faire passer pour le téléphone lié. Une empreinte se compare, elle ne se
 * remonte pas.
 */
export const empreinteAppareil = (id: string | null | undefined): string | null =>
  id ? crypto.createHash('sha256').update(id).digest('hex').slice(0, 6).toUpperCase() : null;

/** « Samsung A14 · #4F2A9C » - pour les exports, qui n'ont pas d'infobulle. */
const libelleAppareil = (u: { appareilId?: string | null; appareilLabel?: string | null }): string => {
  const empreinte = empreinteAppareil(u.appareilId);
  if (!empreinte) return u.appareilLabel ?? '';
  return u.appareilLabel ? `${u.appareilLabel} · #${empreinte}` : `#${empreinte}`;
};

/** Remplace l'identifiant brut par son empreinte dans tout ce qui part au client. */
const vueAppareil = <T extends { appareilId?: string | null }>(u: T) => {
  const { appareilId, ...reste } = u;
  return { ...reste, appareilEmpreinte: empreinteAppareil(appareilId) };
};

export async function getUsers(req: Request, res: Response, next: NextFunction) {
  try {
    const { role, region, is_active, search, prestataire_id, page = '1', limit = '20' } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    // Un compte rattaché à un prestataire ne voit que SES collègues : sans cela,
    // l'annuaire complet (emails, téléphones, rôles, y compris les ADMIN) était
    // lisible par tout superviseur — base idéale de hameçonnage ciblé.
    const moi = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { prestataireId: true } });
    if (moi?.prestataireId) where.prestataireId = moi.prestataireId;
    // Filtre par société : sert à proposer les destinataires d'un envoi. Il ne
    // peut qu'AFFINER le cloisonnement ci-dessus, jamais l'ouvrir.
    if (prestataire_id && !moi?.prestataireId) where.prestataireId = prestataire_id;
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
    res.json({ success: true, data: (data as Array<{ appareilId?: string | null }>).map(vueAppareil), meta });
  } catch (err) { next(err); }
}

export async function getUserById(req: Request, res: Response, next: NextFunction) {
  try {
    const moi = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { prestataireId: true } });
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: SAFE_SELECT });
    // 404 (et non 403) hors périmètre : pas d'énumération de comptes.
    if (!user || (moi?.prestataireId && user.prestataireId !== moi.prestataireId)) {
      throw new AppError('Utilisateur introuvable', 404);
    }
    res.json({ success: true, data: vueAppareil(user) });
  } catch (err) { next(err); }
}

export async function createUser(req: Request, res: Response, next: NextFunction) {
  try {
    const { password, email } = req.body as { password?: string; email?: string };
    const rest = pick<Prisma.UserUncheckedCreateInput>(req.body, [
      'nom', 'prenom', 'telephone', 'role', 'region', 'isActive', 'prestataireId', 'equipe',
    ]);
    // Aucun mot de passe en clair par email : le compte naît avec un secret
    // aléatoire inutilisable, et l'utilisateur définit le sien via un lien à
    // usage unique. (Un mot de passe explicite fourni par l'admin reste honoré.)
    const plain = password || crypto.randomBytes(32).toString('hex');
    const passwordHash = await bcrypt.hash(plain, SALT_ROUNDS);

    const user = await prisma.user.create({
      data: { ...rest, email: String(email).toLowerCase(), passwordHash } as Prisma.UserUncheckedCreateInput,
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
        subject: 'Votre compte E&M OpS - définir votre mot de passe',
        html: `<p>Bonjour ${user.prenom},</p><p>Votre compte a été créé. Cliquez sur ce lien (valable 1 h) pour définir votre mot de passe :</p><p><a href="${link}">${link}</a></p>`,
      });
    }

    res.status(201).json({ success: true, data: vueAppareil(user) });
  } catch (err) { next(err); }
}

export async function updateUser(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Utilisateur introuvable', 404);

    // Liste BLANCHE (et non liste noire) : le reste du corps partait tel quel
    // dans Prisma — appareilId, sessionWebId et même des écritures imbriquées
    // étaient injectables.
    const data = pick<Prisma.UserUncheckedUpdateInput>(req.body, [
      'nom', 'prenom', 'telephone', 'role', 'region', 'isActive', 'prestataireId', 'equipe',
    ]);
    const { password, email } = req.body as { password?: string; email?: string };
    if (email) data.email = String(email).toLowerCase();
    if (password) data.passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const user = await prisma.user.update({ where: { id: req.params.id }, data, select: SAFE_SELECT });
    // Rôle rétrogradé, compte désactivé ou mot de passe changé : les jetons
    // portent le rôle et survivent jusqu'à expiration (JWT_EXPIRES_IN). On
    // révoque toutes les sessions pour que le changement prenne effet tout de suite.
    if (data.role !== undefined || data.isActive === false || data.passwordHash !== undefined) {
      await revoquerToutesSessions(existing.id);
    }
    // Jamais le hash en clair dans le journal d'audit (lisible via /admin/audit
    // et présent dans toutes les sauvegardes).
    await auditLog(req.user!.id, 'UPDATE', 'users', existing.id, { champs: Object.keys(data) }, req);
    res.json({ success: true, data: vueAppareil(user) });
  } catch (err) { next(err); }
}

export async function deleteUser(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.params.id === req.user!.id) throw new AppError('Impossible de supprimer son propre compte', 400);
    const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Utilisateur introuvable', 404);
    // Désactivation (soft delete) pour préserver l'intégrité des historiques
    await prisma.user.update({ where: { id: req.params.id }, data: { isActive: false } });
    // Accès coupé immédiatement (départ, terminal volé) : sinon les jetons
    // vivants gardaient un accès complet jusqu'à leur expiration.
    await revoquerToutesSessions(existing.id);
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
    // Désactivation → coupe l'accès tout de suite (jetons vivants sinon valables
    // jusqu'à expiration).
    if (!user.isActive) await revoquerToutesSessions(existing.id);
    await auditLog(req.user!.id, 'UPDATE', 'users', existing.id, { isActive: user.isActive }, req);
    res.json({ success: true, data: vueAppareil(user) });
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

/**
 * Version de l'app pour l'export : DISTINGUER « jamais vu sur mobile » (vide)
 * de « vu, mais l'APK ne sait pas se déclarer » — ce second cas est justement
 * la liste des téléphones à mettre à jour avant une bascule, il ne doit pas se
 * confondre avec les comptes purement web.
 */
function versionApp(u: { appVersion: string | null; appareilLabel: string | null; appVersionLe: Date | null }): string {
  if (u.appVersion) return u.appVersion;
  if (u.appareilLabel || u.appVersionLe) return 'antérieure à b44';
  return '';
}

export async function exportUsers(req: Request, res: Response, next: NextFunction) {
  try {
    const users = await prisma.user.findMany({ take: EXPORT_MAX, orderBy: { nom: 'asc' }, select: SAFE_SELECT });
    await auditLog(req.user!.id, 'EXPORT', 'users', undefined, { count: users.length }, req);

    const format = req.params.format || 'csv';
    if (format === 'csv') {
      const header = ['Nom','Prénom','Email','Téléphone','Rôle','Région','Actif','Dernière connexion',
        'Version app','Version vue le','Appareil lié'].map((h) => `"${h}"`).join(';');
      // Échappement CSV : un nom commençant par = + - @ est interprété comme une
      // FORMULE par Excel (exécution DDE, exfiltration via HYPERLINK), et un
      // point-virgule non protégé décale toutes les colonnes.
      const csvCell = (v: unknown): string => {
        const t = String(v ?? '');
        const neutralise = /^[=+\-@\t\r]/.test(t) ? `'${t}` : t;
        return `"${neutralise.replace(/"/g, '""')}"`;
      };
      const lines = users.map((u) =>
        [u.nom, u.prenom, u.email, u.telephone ?? '', u.role, u.region ?? '',
          u.isActive ? 'Oui' : 'Non', u.lastLoginAt?.toISOString() ?? '',
          versionApp(u), u.appVersionLe?.toISOString() ?? '', libelleAppareil(u)].map(csvCell).join(';')
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
        { header: 'Version app', key: 'version', width: 16 },
        { header: 'Version vue le', key: 'versionLe', width: 18 },
        { header: 'Appareil lié', key: 'appareil', width: 28 },
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
        version: versionApp(u),
        versionLe: u.appVersionLe ? u.appVersionLe.toLocaleString('fr-FR') : '',
        appareil: libelleAppareil(u),
      })),
    }]);
  } catch (err) { next(err); }
}

/**
 * Délie l'appareil mobile d'un compte terrain (remplacement/perte de téléphone) :
 * le prochain login mobile du compte liera le nouvel appareil.
 */
/**
 * APPAREILS PARTAGÉS : téléphones liés à PLUSIEURS comptes.
 *
 * Le verrou attachait le compte au téléphone, jamais l'inverse : le même
 * identifiant a pu être écrit sur plusieurs comptes avant le correctif. Ces
 * liaisons héritées restent valides tant que personne ne les démêle - cet
 * écran les montre, la déliaison les résout.
 */
export async function appareilsPartages(_req: Request, res: Response, next: NextFunction) {
  try {
    const groupes = await prisma.user.groupBy({
      by: ['appareilId'],
      where: { appareilId: { not: null }, isActive: true },
      _count: { _all: true },
      having: { appareilId: { _count: { gt: 1 } } },
    });
    const ids = groupes.map((g) => g.appareilId!).filter(Boolean);
    if (!ids.length) return res.json({ success: true, data: [] });

    const comptes = await prisma.user.findMany({
      where: { appareilId: { in: ids }, isActive: true },
      select: {
        id: true, nom: true, prenom: true, email: true, role: true,
        appareilId: true, appareilLabel: true, appareilLieLe: true, appVersion: true,
      },
      orderBy: [{ appareilId: 'asc' }, { appareilLieLe: 'asc' }],
    });

    res.json({
      success: true,
      // L'identifiant sert de clé de regroupement côté serveur, jamais de champ
      // de réponse : seule son empreinte sort (cf. empreinteAppareil).
      data: ids.map((appareilId) => ({
        appareilEmpreinte: empreinteAppareil(appareilId),
        // L'étiquette vient du premier compte qui l'a renseignée : c'est le
        // modèle du téléphone, il est le même pour tous.
        appareilLabel: comptes.find((c) => c.appareilId === appareilId && c.appareilLabel)?.appareilLabel ?? null,
        comptes: comptes.filter((c) => c.appareilId === appareilId).map(vueAppareil),
      })),
    });
  } catch (err) { next(err); }
}

export async function delierAppareil(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, appareilLabel: true } });
    if (!user) throw new AppError('Utilisateur introuvable', 404);
    await prisma.user.update({
      where: { id: user.id },
      // La version décrivait CE téléphone : la garder après déliaison ferait
      // croire que le prochain appareil porte déjà cette version.
      data: { appareilId: null, appareilLabel: null, appareilLieLe: null, appVersion: null, appVersionLe: null },
    });
    // La session MOBILE est fermée avec la liaison. Délier un téléphone, c'est dire
    // « ce téléphone n'est plus celui de ce compte » : le laisser connecté jusqu'à
    // 30 jours gardait l'accès à un téléphone perdu ou volé, et privait le compte
    // de sa prochaine liaison (elle ne se fait qu'au login). Le portail web, lui,
    // reste ouvert.
    await revoquerSession(user.id, 'MOBILE');
    await auditLog(req.user!.id, 'UPDATE', 'users', user.id, { action: 'delier_appareil', ancien: user.appareilLabel, sessionMobileFermee: true }, req);
    res.json({ success: true });
  } catch (err) { next(err); }
}
