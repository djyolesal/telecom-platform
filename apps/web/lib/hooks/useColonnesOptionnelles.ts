'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Column } from '@/components/shared/DataTable';
import { COLONNES_OPTIONNELLES, TableOptionnelle } from '@/lib/optionalColumns';

interface ConfigColonnes {
  colonnesOptionnelles?: Partial<Record<TableOptionnelle, string[] | null>> | null;
}

/**
 * Colonnes optionnelles d'un tableau, prêtes à concaténer aux colonnes de base :
 * catalogue filtré par la liste autorisée par l'admin (/config, null = toutes),
 * chacune masquée par défaut (activable via le sélecteur « Colonnes »).
 */
export function useColonnesOptionnelles<T>(table: TableOptionnelle): Column<T>[] {
  const { data } = useQuery({
    queryKey: ['app-config'],
    queryFn: () => api.get('/config').then((r) => r.data.data as ConfigColonnes),
    staleTime: 5 * 60_000,
  });
  const autorisees = data?.colonnesOptionnelles?.[table] ?? null; // null = toutes
  return COLONNES_OPTIONNELLES[table].colonnes
    .filter((c) => autorisees == null || autorisees.includes(c.key))
    .map(({ description: _d, ...c }) => ({ ...(c as Column<T>), defaultHidden: true }));
}
