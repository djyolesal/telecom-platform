import axios from 'axios';
import { getSession } from 'next-auth/react';

/**
 * Client Axios pour l'API REST. Le token JWT est attaché à chaque requête
 * depuis la session NextAuth (côté navigateur).
 */
export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || '/api/v1',
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use(async (config) => {
  if (typeof window !== 'undefined') {
    const session = await getSession();
    const token = (session as { accessToken?: string } | null)?.accessToken;
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      // Session expirée → retour login
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);
