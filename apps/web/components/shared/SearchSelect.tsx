'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';

export interface SearchSelectOption { value: string; label: string }

/**
 * Sélecteur avec recherche pour les longues listes (ex. 700+ sites) : un champ
 * texte filtre les options, clic pour choisir, croix pour effacer. Remplace un
 * <select> classique là où le défilement devient impraticable.
 */
export function SearchSelect({
  value,
  onChange,
  options,
  placeholder = 'Rechercher…',
  emptyLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SearchSelectOption[];
  placeholder?: string;
  /** Libellé de l'option « vide » (ex. « Aucun (raccordement direct) ») - absente si non fourni. */
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  const selection = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) { setOpen(false); setQ(''); }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); setQ(''); } };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const terme = q.trim().toLowerCase();
  const resultats = useMemo(
    () => (terme ? options.filter((o) => o.label.toLowerCase().includes(terme)) : options).slice(0, 50),
    [options, terme]
  );

  const choisir = (v: string) => { onChange(v); setOpen(false); setQ(''); };

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-sm focus:border-[#2471A3] focus:outline-none"
      >
        <span className={selection ? 'text-gray-800' : 'text-gray-400'}>
          {selection ? selection.label : (emptyLabel ?? placeholder)}
        </span>
        <span className="flex items-center gap-1">
          {selection && (
            <X
              size={14}
              className="text-gray-400 hover:text-gray-600"
              onClick={(e) => { e.stopPropagation(); choisir(''); }}
            />
          )}
          <ChevronDown size={15} className="text-gray-400" />
        </span>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 rounded-lg border border-gray-200 bg-white shadow-lg">
          <div className="relative border-b border-gray-100 p-2">
            <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={placeholder}
              className="w-full rounded-md bg-gray-50 py-1.5 pl-7 pr-2 text-sm outline-none focus:bg-white focus:ring-1 focus:ring-[#2471A3]"
            />
          </div>
          <ul className="max-h-56 overflow-y-auto py-1">
            {emptyLabel && !terme && (
              <li>
                <button type="button" onClick={() => choisir('')}
                  className="block w-full px-3 py-1.5 text-left text-sm text-gray-500 hover:bg-gray-50">
                  {emptyLabel}
                </button>
              </li>
            )}
            {resultats.map((o) => (
              <li key={o.value}>
                <button type="button" onClick={() => choisir(o.value)}
                  className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50 ${o.value === value ? 'font-semibold text-[#1B3F6B]' : 'text-gray-700'}`}>
                  {o.label}
                </button>
              </li>
            ))}
            {resultats.length === 0 && <li className="px-3 py-2 text-sm text-gray-400">Aucun résultat</li>}
            {!terme && options.length > 50 && (
              <li className="px-3 py-1.5 text-xs text-gray-400">{options.length - 50} de plus - affinez la recherche…</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
