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

/** Extrait un message lisible d'une erreur axios/inconnue. */
export function errorMessage(err: unknown, fallback = 'Une erreur est survenue'): string {
  const e = err as { response?: { data?: { error?: string } }; message?: string };
  return e?.response?.data?.error || e?.message || fallback;
}
