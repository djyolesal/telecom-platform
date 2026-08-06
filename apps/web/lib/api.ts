import axios from 'axios';
import { getSession } from 'next-auth/react';
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

// Cache de session (30 s) : évite un fetch /api/auth/session à CHAQUE requête
// API (le token est rafraîchi côté serveur dans le callback jwt, avec une marge
// de 2 min — un cache de 30 s ne fait jamais partir un jeton périmé). À 5 s, un
// tableau de bord chargé multipliait les appels /session et nourrissait le
// rate-limit nginx.
let sessionCache: { value: Session | null; at: number } | null = null;
async function cachedSession(): Promise<Session | null> {
  if (sessionCache && Date.now() - sessionCache.at < 30_000) return sessionCache.value;
  const value = (await getSession()) as Session | null;
  // Une session nulle n'est jamais mise en cache : sinon, au retour du login,
  // les requêtes partiraient sans jeton pendant toute la durée du cache.
  sessionCache = value ? { value, at: Date.now() } : null;
  return value;
}

/** Déconnexion déterministe (cf. app/api/deconnexion/route.ts) : le signOut()
 * d'Auth.js bêta laissait vivre les cookies de session découpés en morceaux. */
async function deconnecter(): Promise<void> {
  try { await fetch('/api/auth/deconnexion', { method: 'POST' }); } catch { /* on navigue quand même */ }
  window.location.assign('/login');
}

api.interceptors.request.use(async (config) => {
  if (typeof window !== 'undefined') {
    const session = await cachedSession();
    // Le rafraîchissement du token a échoué → session morte : on déconnecte
    // proprement (supprime le cookie NextAuth) au lieu de boucler sur des 401.
    if (session?.error === 'RefreshTokenError') {
      await deconnecter();
      throw new axios.Cancel('Session expirée');
    }
    let token = session?.accessToken;
    // Trou transitoire (rotation du jeton côté NextAuth) : la session du cache
    // peut arriver SANS accessToken → la requête partirait sans Authorization
    // (« Token manquant »). On invalide le cache et on retente une fois.
    if (!token) {
      sessionCache = null;
      token = ((await cachedSession()) as Session | null)?.accessToken;
    }
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
      await deconnecter();
    }
    return Promise.reject(error);
  }
);
