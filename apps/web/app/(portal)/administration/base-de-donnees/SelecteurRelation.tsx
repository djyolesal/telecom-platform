'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Search, X } from 'lucide-react';
import { api } from '@/lib/api';

interface Option { valeur: string; libelle: string }

/**
 * Sélecteur d'une ligne d'une AUTRE table, pour renseigner une clé étrangère.
 *
 * La recherche est faite par l'API (50 résultats max) et non côté navigateur :
 * certaines tables dépassent le millier de lignes (sites, maintenances), un
 * filtrage local sur une page chargée d'avance manquerait la bonne valeur.
 */
export function SelecteurRelation({
  modeleCible,
  valeur,
  libelleActuel,
  onChange,
  obligatoire,
}: {
  modeleCible: string;
  valeur: string;
  libelleActuel?: string;
  onChange: (valeur: string) => void;
  obligatoire?: boolean;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [q, setQ] = useState('');
  const [recherche, setRecherche] = useState('');
  const boiteRef = useRef<HTMLDivElement>(null);

  // Anti-rafale : une requête après la frappe, pas une par caractère.
  useEffect(() => {
    const t = setTimeout(() => setRecherche(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!ouvert) return;
    const onClic = (e: MouseEvent) => {
      if (boiteRef.current && !boiteRef.current.contains(e.target as Node)) { setOuvert(false); setQ(''); }
    };
    const onTouche = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOuvert(false); setQ(''); } };
    document.addEventListener('mousedown', onClic);
    document.addEventListener('keydown', onTouche);
    return () => { document.removeEventListener('mousedown', onClic); document.removeEventListener('keydown', onTouche); };
  }, [ouvert]);

  const { data: options, isLoading } = useQuery({
    queryKey: ['db-options', modeleCible, recherche],
    queryFn: () => api.get(`/admin/db/tables/${modeleCible}/options`, { params: { q: recherche || undefined } })
      .then((r) => r.data.data as Option[]),
    enabled: ouvert,
  });

  const choisi = options?.find((o) => o.valeur === valeur);
  const affichage = choisi?.libelle ?? libelleActuel ?? valeur;

  return (
    <div ref={boiteRef} className="relative">
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        className="flex w-full items-center justify-between rounded-lg border border-gray-300 bg-white px-3 py-2 text-left text-sm hover:border-gray-400"
      >
        <span className={affichage ? 'truncate text-gray-800' : 'text-gray-400'}>
          {affichage || `Choisir dans ${modeleCible}…`}
        </span>
        <span className="flex items-center gap-1">
          {valeur && !obligatoire && (
            <X
              size={14}
              className="text-gray-400 hover:text-red-500"
              onClick={(e) => { e.stopPropagation(); onChange(''); }}
            />
          )}
          <ChevronDown size={15} className="text-gray-400" />
        </span>
      </button>

      {ouvert && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg">
          <div className="relative border-b border-gray-100 p-2">
            <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Rechercher…"
              className="w-full rounded border border-gray-200 py-1.5 pl-7 pr-2 text-sm outline-none focus:border-[#2471A3]"
            />
          </div>
          <div className="max-h-56 overflow-auto py-1">
            {isLoading && <p className="px-3 py-2 text-xs text-gray-400">Chargement…</p>}
            {!isLoading && !options?.length && <p className="px-3 py-2 text-xs text-gray-400">Aucun résultat</p>}
            {options?.map((o) => (
              <button
                key={o.valeur}
                type="button"
                onClick={() => { onChange(o.valeur); setOuvert(false); setQ(''); }}
                className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50 ${o.valeur === valeur ? 'bg-[#2471A3]/10 font-medium' : ''}`}
              >
                {o.libelle}
                <span className="ml-2 text-[10px] text-gray-400">{o.valeur.slice(0, 8)}</span>
              </button>
            ))}
            {options?.length === 50 && (
              <p className="px-3 py-1.5 text-[11px] text-gray-400">50 premiers résultats — affinez la recherche.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
