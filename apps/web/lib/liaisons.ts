import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * Référentiel des types de liaison de transmission (FIBER, TN, ML, RTN…),
 * servi par l'API (/config) — paramétrable côté serveur sans redéploiement.
 */
export interface TypeLiaison {
  code: string;
  libelle: string;
  famille: string; // FIBRE | FH
  constructeur: string; // HUAWEI | ERICSSON…
}

/**
 * Couleur par code (repli gris pour un code hors référentiel).
 * Quatre TEINTES franchement distinctes — vert / orange / bleu / violet :
 * FIBER et TN partageaient deux verts sarcelle quasi identiques (logique
 * « même famille fibre »), illisibles côte à côte. Le rouge reste réservé aux
 * coupures et l'ambre à l'aval menacé — jamais pour un type de liaison.
 */
export const LIAISON_COULEURS: Record<string, string> = {
  FIBER: '#1E8449', // vert FRANC — fibre (le sarcelle #0E7C6B tirait vers le bleu et se confondait avec ML)
  TN: '#CA6F1E',    // orange cuivré — transmission Huawei (était un 2e vert)
  ML: '#2471A3',    // bleu — MiniLink Ericsson
  RTN: '#7D3C98',   // violet — RTN Huawei
};

export const couleurLiaison = (code?: string | null) => (code && LIAISON_COULEURS[code]) || '#6B7280';

export function useTypesLiaison() {
  const { data } = useQuery({
    queryKey: ['config-types-liaison'],
    queryFn: () => api.get('/config').then((r) => (r.data.data?.typesLiaison ?? []) as TypeLiaison[]),
    staleTime: 30 * 60_000,
  });
  const liste = data ?? [];
  return { liste, parCode: new Map(liste.map((t) => [t.code, t])) };
}
