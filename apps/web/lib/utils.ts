import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Fusionne des classes Tailwind en résolvant les conflits. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Formate un nombre avec séparateurs de milliers (fr-FR). */
export function fmtNumber(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('fr-FR');
}

/** Formate une valeur monétaire en FCFA. */
export function fmtFCFA(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${n.toLocaleString('fr-FR')} FCFA`;
}

/** Formate une date ISO en format court fr-FR. */
export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Formate une date+heure. */
export function fmtDateTime(d: string | Date | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

export const SEVERITE_COLORS: Record<string, string> = {
  CRITIQUE: 'bg-red-100 text-red-700',
  MAJEUR: 'bg-orange-100 text-orange-700',
  MINEUR: 'bg-yellow-100 text-yellow-700',
  INFORMATIF: 'bg-blue-100 text-blue-700',
};

export const STATUT_INCIDENT_COLORS: Record<string, string> = {
  OUVERT: 'bg-red-100 text-red-700',
  EN_COURS: 'bg-orange-100 text-orange-700',
  RESOLU: 'bg-green-100 text-green-700',
  CLOS: 'bg-gray-100 text-gray-600',
};
