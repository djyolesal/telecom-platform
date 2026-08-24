'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Columns3, Inbox, Rows3 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'center';
  /** false = tri désactivé pour cette colonne (par défaut : triable si la donnée brute existe). */
  sortable?: boolean;
  /** Valeur de tri pour les colonnes calculées (sinon la donnée brute row[key]). */
  sortValue?: (row: T) => unknown;
  /** true = masquée au premier affichage (activable via le sélecteur « Colonnes »). */
  defaultHidden?: boolean;
}

/** Comparateur tolérant : numérique quand les deux valeurs le sont, sinon texte (fr). */
function compare(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1; // vides en fin de liste
  if (b == null) return -1;
  const na = Number(a); const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && String(a).trim() !== '' && String(b).trim() !== '') return na - nb;
  return String(a).localeCompare(String(b), 'fr', { sensitivity: 'base' });
}

/**
 * Tableau partagé du portail. Sans rien changer aux pages appelantes, il offre :
 * tri par clic sur l'en-tête, choix des colonnes affichées (mémorisé par page
 * dans le navigateur), densité compact/confort, en-tête épinglé et état vide.
 */
export function DataTable<T>({
  columns,
  data,
  onRowClick,
  rowKey,
  rowClassName,
  emptyMessage = 'Aucune donnée à afficher',
  maxHeight,
  toolbar = true,
  serverSort,
  onServerSort,
}: {
  columns: Column<T>[];
  data: T[];
  onRowClick?: (row: T) => void;
  rowKey?: (row: T, i: number) => string;
  rowClassName?: (row: T) => string | undefined;
  emptyMessage?: string;
  /** ex. '70vh' : active le défilement interne (l'en-tête épinglé prend alors tout son sens). */
  maxHeight?: string;
  /** false = masque la barre d'outils (compteur, densité, colonnes) - petits tableaux. */
  toolbar?: boolean;
  /** Tri DÉLÉGUÉ (pagination serveur) : l'état de tri courant, tenu par la page. */
  serverSort?: { key: string; dir: 1 | -1 } | null;
  /**
   * Fourni = le clic d'en-tête remonte {key, dir} à la page (qui interroge
   * l'API) au lieu de trier localement — un tri local sur pagination serveur
   * ne réordonnerait que la page affichée, en le laissant croire global.
   */
  onServerSort?: (s: { key: string; dir: 1 | -1 } | null) => void;
}) {
  // Préférences par page (les clés de colonnes distinguent plusieurs tableaux d'une même page).
  const storageKey = useMemo(
    () => `datatable:${typeof window !== 'undefined' ? window.location.pathname : ''}:${columns.map((c) => c.key).join('|')}`,
    [columns]
  );
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(columns.filter((c) => c.defaultHidden).map((c) => c.key))
  );
  const [dense, setDense] = useState(false);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Rechargement des préférences (après montage : évite tout écart SSR/client).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const prefs = JSON.parse(raw) as { hidden?: string[]; dense?: boolean };
      const valides = (prefs.hidden ?? []).filter((k) => columns.some((c) => c.key === k));
      if (valides.length < columns.length) setHidden(new Set(valides));
      setDense(!!prefs.dense);
    } catch { /* préférences illisibles → défauts */ }
  }, [storageKey, columns]);

  const savePrefs = (h: Set<string>, d: boolean) => {
    try { localStorage.setItem(storageKey, JSON.stringify({ hidden: [...h], dense: d })); } catch { /* stockage plein/privé */ }
  };

  useEffect(() => {
    if (!pickerOpen) return;
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [pickerOpen]);

  const visibles = columns.filter((c) => !hidden.has(c.key));

  const sortValueOf = (col: Column<T>, row: T): unknown =>
    col.sortValue ? col.sortValue(row) : (row as Record<string, unknown>)[col.key];

  // Tri délégué : l'état vit chez la page, les lignes arrivent déjà triées.
  const delegue = !!onServerSort;
  const sortActif = delegue ? (serverSort ?? null) : sort;

  const isSortable = (col: Column<T>): boolean => {
    if (col.sortable === false) return false;
    if (delegue) return true; // le serveur sait trier même une colonne vide sur cette page
    if (col.sortValue) return true;
    return data.some((r) => (r as Record<string, unknown>)[col.key] != null);
  };

  const rows = useMemo(() => {
    if (delegue || !sort) return data;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return data;
    return [...data].sort((a, b) => compare(sortValueOf(col, a), sortValueOf(col, b)) * sort.dir);
  }, [data, sort, columns, delegue]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleCol = (key: string) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else if (visibles.length > 1) next.add(key); // toujours au moins une colonne
    setHidden(next); savePrefs(next, dense);
  };

  const cellPad = dense ? 'px-3 py-1.5' : 'px-3 py-2.5';

  return (
    <div className="overflow-hidden rounded-xl border border-gray-100 bg-white">
      {/* Barre d'outils du tableau */}
      {toolbar && (
      <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-1.5">
        <span className="text-xs text-gray-400">
          {data.length} ligne{data.length > 1 ? 's' : ''}
          {hidden.size > 0 && ` · ${visibles.length}/${columns.length} colonnes`}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => { const d = !dense; setDense(d); savePrefs(hidden, d); }}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700"
          title="Densité d'affichage"
        >
          <Rows3 size={14} /> {dense ? 'Confort' : 'Compact'}
        </button>
        <div className="relative" ref={panelRef}>
          <button
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium hover:bg-gray-50',
              hidden.size > 0 ? 'text-[#0E7C6B]' : 'text-gray-500 hover:text-gray-700'
            )}
          >
            <Columns3 size={14} /> Colonnes
          </button>
          {pickerOpen && (
            <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
              <p className="px-1.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Colonnes affichées</p>
              <div className="max-h-64 overflow-y-auto">
                {columns.map((c) => (
                  <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm text-gray-700 hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={!hidden.has(c.key)}
                      onChange={() => toggleCol(c.key)}
                      className="h-3.5 w-3.5 rounded border-gray-300 text-[#0E7C6B] focus:ring-[#0E7C6B]"
                    />
                    {c.header}
                  </label>
                ))}
              </div>
              {hidden.size > 0 && (
                <button
                  type="button"
                  onClick={() => { setHidden(new Set()); savePrefs(new Set(), dense); }}
                  className="mt-1 w-full rounded-md px-1.5 py-1 text-left text-xs text-[#2471A3] hover:bg-gray-50"
                >
                  Tout réafficher
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      )}

      <div className="overflow-x-auto" style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              {visibles.map((c) => {
                const triable = isSortable(c);
                const actif = sortActif?.key === c.key;
                const cycle = () => {
                  // asc → desc → tri par défaut
                  const suivant = actif && sortActif!.dir === -1 ? null : { key: c.key, dir: (actif ? -1 : 1) as 1 | -1 };
                  if (delegue) onServerSort!(suivant);
                  else setSort(suivant);
                };
                return (
                  <th
                    key={c.key}
                    onClick={triable ? cycle : undefined}
                    className={cn(
                      'sticky top-0 z-10 bg-gray-50/95 px-3 py-2.5 text-xs font-semibold uppercase tracking-wide backdrop-blur',
                      actif ? 'text-[#1B3F6B]' : 'text-gray-500',
                      triable && 'cursor-pointer select-none hover:text-gray-700',
                      c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left',
                      c.className
                    )}
                  >
                    <span className="inline-flex items-center gap-0.5">
                      {c.header}
                      {actif && (sortActif!.dir === 1 ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={rowKey ? rowKey(row, i) : (row as { id?: string }).id ?? i}
                onClick={() => onRowClick?.(row)}
                className={cn(
                  'border-b border-gray-50 transition-colors last:border-0',
                  onRowClick && 'cursor-pointer hover:bg-[#2471A3]/5',
                  rowClassName?.(row)
                )}
              >
                {visibles.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      cellPad, 'text-gray-700',
                      c.align === 'right' ? 'text-right tabular-nums' : c.align === 'center' ? 'text-center' : 'text-left',
                      c.className
                    )}
                  >
                    {c.render ? c.render(row) : ((row as Record<string, unknown>)[c.key] as React.ReactNode) ?? '—'}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={visibles.length} className="px-3 py-12 text-center">
                  <Inbox size={28} className="mx-auto mb-2 text-gray-200" />
                  <p className="text-sm text-gray-400">{emptyMessage}</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
