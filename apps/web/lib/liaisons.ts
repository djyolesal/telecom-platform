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

/** Couleur par code (repli gris pour un code hors référentiel). */
export const LIAISON_COULEURS: Record<string, string> = {
  FIBER: '#0E7C6B',
  TN: '#148F77',
  ML: '#2471A3',
  RTN: '#7D3C98',
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
