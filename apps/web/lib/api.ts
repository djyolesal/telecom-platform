import axios from 'axios';
import { getSession, signOut } from 'next-auth/react';
import type { Session } from 'next-auth';

/**
 * Client Axios pour l'API REST. Le token JWT est attaché à chaque requête
 * depuis la session NextAuth (côté navigateur).
 */
export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || '/api/v1',
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

// Petit cache de session (5 s) : évite un fetch /api/auth/session à CHAQUE requête
// API (le token est rafraîchi côté serveur dans le callback jwt).
let sessionCache: { value: Session | null; at: number } | null = null;
async function cachedSession(): Promise<Session | null> {
  if (sessionCache && Date.now() - sessionCache.at < 5000) return sessionCache.value;
  const value = (await getSession()) as Session | null;
  sessionCache = { value, at: Date.now() };
  return value;
}

api.interceptors.request.use(async (config) => {
  if (typeof window !== 'undefined') {
    const session = await cachedSession();
    // Le rafraîchissement du token a échoué → session morte : on déconnecte
    // proprement (supprime le cookie NextAuth) au lieu de boucler sur des 401.
    if (session?.error === 'RefreshTokenError') {
      await signOut({ callbackUrl: '/login' });
      throw new axios.Cancel('Session expirée');
    }
    const token = session?.accessToken;
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  // Pour un envoi FormData (import xlsx, upload photo), on retire le Content-Type
  // JSON par défaut : le navigateur pose alors multipart/form-data avec le boundary.
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
    const h = config.headers as unknown as { delete?: (k: string) => void };
    if (typeof h.delete === 'function') h.delete('Content-Type');
    else delete (config.headers as unknown as Record<string, unknown>)['Content-Type'];
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      // Déconnexion PROPRE : signOut invalide le cookie NextAuth (30 j), sinon le
      // middleware, voyant le cookie encore valide, renverrait vers le dashboard
      // → nouvelle salve de 401 → boucle infinie.
      sessionCache = null;
      await signOut({ callbackUrl: '/login' });
    }
    return Promise.reject(error);
  }
);
