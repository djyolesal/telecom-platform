'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * Filtres d'une liste rangés dans l'URL, et non dans l'état React.
 *
 * Le défaut corrigé : on filtre une liste, on ouvre une fiche, on revient — et
 * tout est à refaire, parce que le retour remonte le composant avec son état
 * initial. En portant les filtres dans la query, le bouton « retour » du
 * navigateur restaure l'URL, donc les filtres ; et une vue filtrée devient
 * partageable par simple copie du lien.
 *
 * `replace` et non `push` : la frappe dans une recherche produirait sinon un
 * cran d'historique par caractère, et « retour » remonterait lettre à lettre.
 *
 * Toute clé remise à sa valeur par défaut QUITTE l'URL : une liste sans filtre
 * garde une adresse propre.
 */
export function useFiltresUrl<T extends Record<string, string>>(defauts: T) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const valeurs = useMemo(() => {
    const v = { ...defauts };
    for (const cle of Object.keys(defauts) as (keyof T)[]) {
      const brut = params.get(String(cle));
      if (brut !== null) v[cle] = brut as T[keyof T];
    }
    return v;
  }, [params, defauts]);

  const appliquer = useCallback((patch: Partial<T>) => {
    const suivant = new URLSearchParams(params.toString());
    for (const [cle, val] of Object.entries(patch)) {
      const value = String(val ?? '');
      if (value === '' || value === String(defauts[cle] ?? '')) suivant.delete(cle);
      else suivant.set(cle, value);
    }
    const qs = suivant.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [params, pathname, router, defauts]);

  const reinitialiser = useCallback(() => router.replace(pathname, { scroll: false }), [pathname, router]);

  return { valeurs, appliquer, reinitialiser };
}
