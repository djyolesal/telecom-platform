'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Column } from '@/components/shared/DataTable';
import { COLONNES_OPTIONNELLES, TableOptionnelle } from '@/lib/optionalColumns';

interface ConfigColonnes {
  colonnesOptionnelles?: Partial<Record<TableOptionnelle, string[] | null>> | null;
  colonnesMasquees?: Partial<Record<TableOptionnelle, string[] | null>> | null;
}

/**
 * Colonnes optionnelles d'un tableau, prêtes à concaténer aux colonnes de base,
 * chacune masquée par défaut (activable via le sélecteur « Colonnes »).
 *
 * Filtre admin : liste NOIRE `colonnesMasquees` (une colonne ajoutée au
 * catalogue après l'enregistrement reste donc proposée). Repli sur l'ancienne
 * liste blanche `colonnesOptionnelles` tant que l'admin n'a pas ré-enregistré —
 * elle, figeait le catalogue et faisait « disparaître » les nouvelles colonnes.
 */
export function useColonnesOptionnelles<T>(table: TableOptionnelle): Column<T>[] {
  const { data } = useQuery({
    queryKey: ['app-config'],
    queryFn: () => api.get('/config').then((r) => r.data.data as ConfigColonnes),
    staleTime: 5 * 60_000,
  });
  const masquees = data?.colonnesMasquees?.[table];
  const visible = Array.isArray(masquees)
    ? (c: { key: string }) => !masquees.includes(c.key)
    : (() => {
        const autorisees = data?.colonnesOptionnelles?.[table] ?? null; // null = toutes
        return (c: { key: string }) => autorisees == null || autorisees.includes(c.key);
      })();
  return COLONNES_OPTIONNELLES[table].colonnes
    .filter(visible)
    .map(({ description: _d, ...c }) => ({ ...(c as Column<T>), defaultHidden: true }));
}
