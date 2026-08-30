'use client';

// Mini bus de notifications (sans dépendance) : `toast()` émet un événement que
// le composant <Toaster/> affiche. Utilisé notamment par le onError global des
// mutations React Query pour ne plus avoir d'échecs silencieux.

export type ToastKind = 'error' | 'success' | 'info';
export interface ToastEvent { id: number; kind: ToastKind; message: string }

let counter = 0;

export function toast(message: string, kind: ToastKind = 'info') {
  if (typeof window === 'undefined') return;
  const detail: ToastEvent = { id: ++counter, kind, message };
  window.dispatchEvent(new CustomEvent('app:toast', { detail }));
}

/**
 * Extrait un message MÉTIER d'une erreur axios/inconnue. Jamais `e.message`
 * brut (« Request failed with status code 500 », « Network Error », « timeout
 * of 30000ms exceeded ») face à l'utilisateur : le serveur rédige ses erreurs
 * en français (response.data.error) ; sinon on distingue les grands cas.
 */
export function errorMessage(err: unknown, fallback = 'Une erreur est survenue'): string {
  const e = err as { response?: { status?: number; data?: { error?: string } }; code?: string; message?: string };
  if (e?.response?.data?.error) return e.response.data.error;
  if (e?.code === 'ERR_NETWORK' || e?.message === 'Network Error') {
    return 'Connexion perdue. Vérifiez votre accès internet, puis réessayez.';
  }
  if (e?.code === 'ECONNABORTED' || (e?.message ?? '').includes('timeout')) {
    return 'Le serveur met trop de temps à répondre. Réessayez dans quelques instants.';
  }
  if ((e?.response?.status ?? 0) >= 500) {
    return 'Le service est momentanément indisponible. Réessayez dans quelques instants.';
  }
  return fallback;
}
