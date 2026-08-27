'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { TYPES_INCIDENT } from '@/lib/constants';

/**
 * Référentiel des types d'incident (éditable en admin) : options des
 * formulaires/filtres + libellé d'un code (y compris désactivé ou historique —
 * un code inconnu s'affiche tel quel plutôt que de casser l'affichage).
 * Repli sur la constante historique tant que l'API n'a pas répondu.
 */
export function useTypesIncident() {
  const { data } = useQuery({
    queryKey: ['types-incident'],
    queryFn: () => api.get('/types-incident').then((r) => r.data.data as { code: string; libelle: string; actif: boolean }[]),
    staleTime: 5 * 60_000,
  });
  const tous = data ?? TYPES_INCIDENT.map((t) => ({ code: t.value, libelle: t.label, actif: true }));
  const options = tous.filter((t) => t.actif).map((t) => ({ value: t.code, label: t.libelle }));
  const labelDe = (code?: string | null) => tous.find((t) => t.code === code)?.libelle ?? code ?? '—';
  return { options, labelDe };
}
