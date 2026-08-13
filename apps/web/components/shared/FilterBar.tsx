'use client';

import { Search } from 'lucide-react';

export interface SelectFilter {
  key: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  /**
   * true = l'intitulé n'est PAS un choix : il disparaît de la liste déroulante.
   * Indispensable pour les sélecteurs à valeur obligatoire (ex. « Période ») où
   * choisir l'intitulé revenait à un retour silencieux à la valeur par défaut.
   */
  sansVide?: boolean;
}

export function FilterBar({
  search,
  onSearch,
  searchPlaceholder = 'Rechercher…',
  filters = [],
  children,
}: {
  search?: string;
  onSearch?: (v: string) => void;
  searchPlaceholder?: string;
  filters?: SelectFilter[];
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      {onSearch && (
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search ?? ''}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full rounded-lg border border-gray-200 pl-9 pr-3 py-2 text-sm focus:border-[#2471A3] focus:ring-2 focus:ring-[#2471A3]/20 outline-none"
          />
        </div>
      )}
      {filters.map((f) => (
        <select
          key={f.key}
          value={f.value}
          onChange={(e) => f.onChange(e.target.value)}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm bg-white focus:border-[#2471A3] outline-none"
        >
          <option value="" disabled={f.sansVide} hidden={f.sansVide}>{f.label}</option>
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ))}
      {children}
    </div>
  );
}
