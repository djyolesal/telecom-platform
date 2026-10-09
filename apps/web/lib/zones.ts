import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * Zones de maintenance (découpage terrain du parc, LOME 1, KARA…) et leur
 * responsable (FME). Le filtre `zone_id` des listes accepte un identifiant, ou
 * `aucune` pour les sites sans zone.
 */
export interface ZoneMaintenance {
  id: string;
  nom: string;
  nbSites: number;
  responsable: { id: string; nom: string; prenom: string; telephone: string | null; email: string | null; societe: string } | null;
}

export function useZonesMaintenance() {
  return useQuery({
    queryKey: ['zones-maintenance'],
    queryFn: () => api.get('/zones-maintenance').then((r) => r.data.data as ZoneMaintenance[]),
    staleTime: 5 * 60_000,
  });
}

/**
 * Options d'un filtre « zone » : les zones, puis « Sans zone ». Vide tant
 * qu'aucune zone n'existe - le filtre est alors masqué par les pages.
 */
export function useOptionsZones(): { value: string; label: string }[] {
  const { data } = useZonesMaintenance();
  if (!data?.length) return [];
  return [...data.map((z) => ({ value: z.id, label: z.nom })), { value: 'aucune', label: 'Sans zone' }];
}
