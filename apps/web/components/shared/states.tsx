import { Inbox, AlertCircle } from 'lucide-react';

/**
 * ── RÈGLE D'ATTENTE DU PORTAIL ──────────────────────────────────────────────
 * Deux traitements, chacun là où il est le meilleur — ne pas les mélanger :
 *
 *  • `<TableSkeleton />` → pages de LISTE / TABLEAU (sites, incidents, relevés,
 *    dépotages, utilisateurs…). Le squelette préfigure les lignes : la page ne
 *    « saute » pas quand les données arrivent.
 *
 *  • `<Loading />` → pages de DÉTAIL, de RAPPORT et tableaux de bord composés
 *    (fiche d'un site, d'un BC/BL, disponibilité réseau, fiche de validation…).
 *    Aucune structure régulière à préfigurer : on affiche le loader de marque.
 *
 *  • FORMULAIRES de saisie (« nouveau ») et formulaires de génération de
 *    rapport → AUCUN bloc d'attente : les champs s'affichent immédiatement et
 *    les listes déroulantes se remplissent à l'arrivée des données. Bloquer le
 *    formulaire entier serait plus lent à l'usage. L'état d'envoi est porté par
 *    le bouton (`loading={isPending}`).
 *    Convention : quand une liste déroulante attend sa source, son `placeholder`
 *    l'annonce (« Chargement des prestataires… ») — un menu vide qui invite à
 *    choisir laisse croire qu'il n'y a rien à sélectionner.
 *
 * Toute nouvelle page doit se ranger dans l'un de ces trois cas.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Loader de marque : l'Écrou-signal « émet » et la Ligne de vie se trace en boucle. */
export function Loading({ label = 'Chargement…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2.5 py-16 text-sm text-gray-400">
      <svg width="58" height="58" viewBox="0 0 120 120" aria-hidden="true">
        <path d="M104 60 L82 98 L38 98 L16 60 L38 22 L82 22 Z" fill="none" stroke="#1B3F6B" strokeWidth="9" strokeLinejoin="round" />
        <circle cx="60" cy="64" r="7" fill="#F59E0B" />
        <path className="emops-arc1" d="M46 52 A18 18 0 0 1 74 52" fill="none" stroke="#0E7C6B" strokeWidth="6.5" strokeLinecap="round" />
        <path className="emops-arc2" d="M40 45 A25 25 0 0 1 80 45" fill="none" stroke="#0E7C6B" strokeWidth="6.5" strokeLinecap="round" />
      </svg>
      <svg width="140" height="20" viewBox="0 0 200 24" aria-hidden="true">
        <path className="emops-trace" d="M4 16 H150 l6 -11 l9 18 l7 -8 H186" fill="none" stroke="#F59E0B" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="194" cy="16" r="4" fill="#0E7C6B" />
      </svg>
      {label}
    </div>
  );
}

export function TableSkeleton({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="animate-pulse space-y-2">
      <div className="h-9 bg-gray-200 rounded" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {Array.from({ length: cols }).map((_, j) => (
            <div key={j} className="h-8 bg-gray-100 rounded" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title = 'Aucune donnée', hint }: { title?: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Inbox size={32} className="text-gray-300 mb-2" />
      <p className="text-sm font-medium text-gray-500">{title}</p>
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

export function ErrorState({ message = 'Une erreur est survenue' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <AlertCircle size={32} className="text-red-300 mb-2" />
      <p className="text-sm font-medium text-red-500">{message}</p>
    </div>
  );
}
