/**
 * Conversion hauteur de gasoil mesurée (cm) → litres, selon la configuration
 * de la cuve du site. Trois méthodes, par ordre de priorité :
 *
 * 1. BARÉMAGE (≥ 2 points) : interpolation linéaire entre les couples
 *    hauteur → litres du certificat de jaugeage — c'est la référence
 *    métrologique quand elle existe, quelle que soit la forme.
 * 2. RECTANGULAIRE : volume linéaire, longueur × largeur × hauteur.
 * 3. CYLINDRE COUCHÉ : aire du segment circulaire × longueur — la relation
 *    hauteur/volume n'y est PAS linéaire (une demi-hauteur ≠ un demi-volume),
 *    c'est précisément le calcul source d'erreurs à la main.
 *
 * Toutes les dimensions sont en cm, le résultat en litres (1 L = 1000 cm³).
 */

export interface PointBaremage {
  hauteurCm: number;
  litres: number;
}

export interface ConfigCuve {
  formeCuve?: 'RECTANGULAIRE' | 'CYLINDRE_COUCHE' | null;
  cuveLongueurCm?: number | null;
  cuveLargeurCm?: number | null;
  cuveHauteurCm?: number | null;
  cuveDiametreCm?: number | null;
  baremage?: PointBaremage[] | null;
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Barème utilisable : au moins 2 points, trié par hauteur croissante. */
function baremeUtilisable(cfg: ConfigCuve): PointBaremage[] | null {
  const pts = (cfg.baremage ?? [])
    .map((p) => ({ hauteurCm: Number(p.hauteurCm), litres: Number(p.litres) }))
    .filter((p) => Number.isFinite(p.hauteurCm) && Number.isFinite(p.litres) && p.hauteurCm >= 0 && p.litres >= 0)
    .sort((a, b) => a.hauteurCm - b.hauteurCm);
  return pts.length >= 2 ? pts : null;
}

/** Aire (cm²) du segment circulaire d'un cylindre couché rempli à h cm. */
function aireSegment(rayonCm: number, hCm: number): number {
  const r = rayonCm;
  const h = Math.min(Math.max(hCm, 0), 2 * r);
  return r * r * Math.acos((r - h) / r) - (r - h) * Math.sqrt(Math.max(2 * r * h - h * h, 0));
}

/** Hauteur interne maximale mesurable (cm), ou null si non configurée. */
export function hauteurMaxCm(cfg: ConfigCuve): number | null {
  const bareme = baremeUtilisable(cfg);
  if (bareme) return bareme[bareme.length - 1].hauteurCm;
  if (cfg.formeCuve === 'RECTANGULAIRE') return num(cfg.cuveHauteurCm);
  if (cfg.formeCuve === 'CYLINDRE_COUCHE') return num(cfg.cuveDiametreCm);
  return null;
}

/**
 * Litres pour une hauteur mesurée. null = cuve non configurée (la saisie
 * manuelle des litres reste alors la seule voie). Hauteur bornée à [0, max].
 */
export function litresPourHauteur(cfg: ConfigCuve, hauteurCm: number): number | null {
  if (!Number.isFinite(hauteurCm) || hauteurCm < 0) return null;

  const bareme = baremeUtilisable(cfg);
  if (bareme) {
    if (hauteurCm <= bareme[0].hauteurCm) {
      // Sous le premier point : proportionnel depuis (0, 0) — un barème ne
      // descend pas toujours jusqu'au fond de cuve.
      const p = bareme[0];
      return p.hauteurCm > 0 ? arrondi((hauteurCm / p.hauteurCm) * p.litres) : p.litres;
    }
    const dernier = bareme[bareme.length - 1];
    if (hauteurCm >= dernier.hauteurCm) return arrondi(dernier.litres);
    for (let i = 1; i < bareme.length; i++) {
      const a = bareme[i - 1]; const b = bareme[i];
      if (hauteurCm <= b.hauteurCm) {
        const t = (hauteurCm - a.hauteurCm) / (b.hauteurCm - a.hauteurCm);
        return arrondi(a.litres + t * (b.litres - a.litres));
      }
    }
  }

  if (cfg.formeCuve === 'RECTANGULAIRE') {
    const L = num(cfg.cuveLongueurCm); const l = num(cfg.cuveLargeurCm); const H = num(cfg.cuveHauteurCm);
    if (!L || !l || !H) return null;
    const h = Math.min(hauteurCm, H);
    return arrondi((L * l * h) / 1000);
  }

  if (cfg.formeCuve === 'CYLINDRE_COUCHE') {
    const d = num(cfg.cuveDiametreCm); const L = num(cfg.cuveLongueurCm);
    if (!d || !L) return null;
    return arrondi((aireSegment(d / 2, hauteurCm) * L) / 1000);
  }

  return null;
}

/** Volume à hauteur max (L) — à confronter au volume nominal déclaré. */
export function volumeMaxLitres(cfg: ConfigCuve): number | null {
  const max = hauteurMaxCm(cfg);
  return max == null ? null : litresPourHauteur(cfg, max);
}

/** Une cuve est « calculable » si une conversion est possible. */
export function cuveCalculable(cfg: ConfigCuve): boolean {
  return volumeMaxLitres(cfg) != null;
}

const arrondi = (l: number) => Math.round(l * 10) / 10;
