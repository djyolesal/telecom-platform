import { z } from 'zod';

/**
 * Schémas des routes d'authentification.
 *
 * Sans validation, `POST /auth/login` avec un corps vide plantait sur
 * `email.toLowerCase()` → 500 non géré, exploitable pour saturer les logs.
 * Ces schémas transforment ces cas en 400 explicites.
 */

const email = z.string().trim().toLowerCase().email('Adresse email invalide').max(100);
const motDePasse = z.string().min(1, 'Mot de passe requis').max(200);

export const loginSchema = z.object({
  email,
  password: motDePasse,
  // Plateforme + identité d'appareil (verrou des comptes terrain).
  platform: z.enum(['WEB', 'MOBILE']).optional(),
  deviceId: z.string().max(100).optional(),
  deviceLabel: z.string().max(80).optional(),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({
  token: z.string().min(16, 'Jeton invalide').max(200),
  // Longueur minimale alignée sur la politique du portail.
  password: z.string().min(8, 'Le mot de passe doit contenir au moins 8 caractères').max(200),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(10).max(2000),
});

export const updatePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Mot de passe actuel requis').max(200),
  newPassword: z.string().min(8, 'Le nouveau mot de passe doit contenir au moins 8 caractères').max(200),
});
