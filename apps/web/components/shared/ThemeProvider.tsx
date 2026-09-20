'use client';

import { useEffect } from 'react';
import { api } from '@/lib/api';

/**
 * Applique le thème de l'établissement aux variables CSS de la page.
 *
 * Pourquoi côté client et pas dans la feuille de style : la charte est un
 * RÉGLAGE, pas une constante. La changer ne doit pas demander une livraison de
 * code — l'administrateur choisit, tout le monde voit.
 *
 * Le thème par défaut reste écrit dans globals.css : si l'API ne répond pas,
 * l'interface garde des couleurs lisibles au lieu de s'afficher en noir sur
 * blanc. On ne remplace donc jamais par du vide.
 */
export function ThemeProvider() {
  useEffect(() => {
    let annule = false;
    api.get('/ui/theme')
      .then((r) => {
        if (annule) return;
        const t = r.data?.data?.actuel as Record<string, string> | undefined;
        if (!t) return;
        const racine = document.documentElement;
        const appliquer = (variable: string, valeur?: string) => {
          if (valeur && /^\d{1,3} \d{1,3} \d{1,3}$/.test(valeur)) {
            racine.style.setProperty(variable, valeur);
          }
        };
        appliquer('--brand', t.brand);
        appliquer('--brand-light', t.brandLight);
        appliquer('--accent', t.accent);
        appliquer('--accent-light', t.accentLight);
        appliquer('--brand-tint', t.brandTint);
        appliquer('--brand-accent', t.brandAccent);
      })
      .catch(() => {/* thème par défaut conservé : jamais bloquant */});
    return () => { annule = true; };
  }, []);
  return null;
}
