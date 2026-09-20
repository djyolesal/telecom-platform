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
}

export const THEMES: Theme[] = [
  {
    cle: 'emops', nom: 'E&M OpS (par défaut)',
    brand: '27 63 107', brandLight: '36 113 163',
    accent: '14 124 107', accentLight: '59 201 175', brandTint: '234 241 248',
  },
  {
    // Charte MOOV AFRICA : orange dominant, bleu nuit en appui. Valeurs
    // APPROCHÉES d'après l'identité visible publiquement — à corriger avec la
    // charte officielle, d'où le thème « personnalisé » ci-dessous qui permet
    // de saisir les valeurs exactes sans toucher au code.
    cle: 'moov', nom: 'Moov Africa',
    brand: '0 40 85', brandLight: '242 125 15',
    accent: '0 106 166', accentLight: '255 176 59', brandTint: '255 243 230',
  },
  {
    cle: 'sombre', nom: 'Ardoise (contraste élevé)',
    brand: '31 41 55', brandLight: '75 85 99',
    accent: '5 150 105', accentLight: '52 211 153', brandTint: '243 244 246',
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
