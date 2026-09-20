import { Request, Response, NextFunction } from 'express';
import { getRaw } from '../services/settings.service';

/**
 * THÈME DE L'INTERFACE WEB.
 *
 * Les couleurs sont servies en TRIPLETS RVB (« 27 63 107 ») parce que
 * l'interface les consomme via `rgb(var(--brand) / opacité)` : un hexadécimal
 * empêcherait toute transparence, or l'interface en compte une trentaine.
 *
 * Seules les couleurs de MARQUE sont thémables. Les couleurs de STATUT — rouge
 * danger, ambre alerte — n'en font pas partie : un incident critique doit
 * rester rouge quelle que soit la charte, sinon on rend illisible ce qui doit
 * sauter aux yeux.
 */
export interface Theme {
  cle: string;
  nom: string;
  brand: string;
  brandLight: string;
  accent: string;
  accentLight: string;
  brandTint: string;
  /** Accent d'IDENTITÉ : logo et onglet actif, rien d'autre. Volontairement
   *  rare — c'est la retenue qui fait paraître une interface propre. */
  brandAccent: string;
}

export const THEMES: Theme[] = [
  {
    cle: 'emops', nom: 'E&M OpS (par défaut)',
    brand: '27 63 107', brandLight: '36 113 163',
    accent: '14 124 107', accentLight: '59 201 175', brandTint: '234 241 248',
    brandAccent: '36 113 163',
  },
  {
    // Charte MOOV AFRICA — bleu nuit structurant, bleu agissant, orange
    // IDENTITAIRE. L'orange n'est PAS la couleur d'action : mesuré, il est à
    // 1,05:1 du statut « majeur » (donc indiscernable d'une pastille de
    // sévérité) et à 2,72:1 du blanc (donc illisible sous un libellé de
    // bouton). Il vit sur le logo et l'onglet actif — visible, rare, sans
    // charge sémantique. Valeurs APPROCHÉES d'après l'identité publique : les
    // surcharges `ui.theme.*` permettent de poser la charte officielle sans
    // toucher au code, et cette RÉPARTITION DES RÔLES tient quelles que
    // soient les nuances exactes.
    cle: 'moov', nom: 'Moov Africa',
    brand: '0 40 85', brandLight: '0 106 166',
    accent: '0 112 127', accentLight: '14 124 107', brandTint: '234 242 248',
    brandAccent: '242 125 15',
  },
  {
    cle: 'sombre', nom: 'Ardoise (contraste élevé)',
    brand: '31 41 55', brandLight: '75 85 99',
    accent: '5 150 105', accentLight: '4 120 87', brandTint: '243 244 246',
    brandAccent: '5 150 105',
  },
];

/** Thème effectif : préréglage choisi, éventuellement corrigé couleur par couleur. */
export function themeEffectif(): Theme {
  const cle = typeof getRaw('ui.theme') === 'string' ? String(getRaw('ui.theme')) : 'emops';
  const base = THEMES.find((t) => t.cle === cle) ?? THEMES[0];
  // Surcharges : la charte d'un opérateur évolue, et une valeur exacte ne doit
  // pas attendre une livraison de code.
  const perso = (champ: keyof Theme): string => {
    const v = getRaw(`ui.theme.${champ}`);
    return typeof v === 'string' && /^\d{1,3} \d{1,3} \d{1,3}$/.test(v.trim()) ? v.trim() : (base[champ] as string);
  };
  return {
    ...base,
    brand: perso('brand'), brandLight: perso('brandLight'), accent: perso('accent'),
    accentLight: perso('accentLight'), brandTint: perso('brandTint'),
    brandAccent: perso('brandAccent'),
  };
}

/**
 * PUBLIC : l'écran de connexion doit être aux couleurs de la maison avant
 * toute authentification. Une palette ne révèle rien.
 */
export async function getTheme(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, data: { actuel: themeEffectif(), disponibles: THEMES } });
  } catch (err) { next(err); }
}
