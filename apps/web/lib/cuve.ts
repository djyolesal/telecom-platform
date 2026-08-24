/**
 * Conversion hauteur de gasoil (cm) → litres — MIROIR de apps/api/src/utils/cuve.ts
 * (même logique, mêmes priorités) pour l'affichage instantané côté navigateur.
 * Toute évolution doit être reportée dans les deux fichiers (et le mobile en Dart).
 *
 * Priorités : barémage (≥ 2 points, interpolation linéaire) > rectangulaire
 * (linéaire) > cylindre couché (segment circulaire — non linéaire).
 */

export interface PointBaremage { hauteurCm: number; litres: number }

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

const arrondi = (l: number) => Math.round(l * 10) / 10;

function baremeUtilisable(cfg: ConfigCuve): PointBaremage[] | null {
  const pts = (cfg.baremage ?? [])
    .map((p) => ({ hauteurCm: Number(p.hauteurCm), litres: Number(p.litres) }))
    .filter((p) => Number.isFinite(p.hauteurCm) && Number.isFinite(p.litres) && p.hauteurCm >= 0 && p.litres >= 0)
    .sort((a, b) => a.hauteurCm - b.hauteurCm);
  return pts.length >= 2 ? pts : null;
}

function aireSegment(rayonCm: number, hCm: number): number {
  const r = rayonCm;
  const h = Math.min(Math.max(hCm, 0), 2 * r);
  return r * r * Math.acos((r - h) / r) - (r - h) * Math.sqrt(Math.max(2 * r * h - h * h, 0));
}

export function hauteurMaxCm(cfg: ConfigCuve): number | null {
  const bareme = baremeUtilisable(cfg);
  if (bareme) return bareme[bareme.length - 1].hauteurCm;
  if (cfg.formeCuve === 'RECTANGULAIRE') return num(cfg.cuveHauteurCm);
  if (cfg.formeCuve === 'CYLINDRE_COUCHE') return num(cfg.cuveDiametreCm);
  return null;
}

export function litresPourHauteur(cfg: ConfigCuve, hauteurCm: number): number | null {
  if (!Number.isFinite(hauteurCm) || hauteurCm < 0) return null;

  const bareme = baremeUtilisable(cfg);
  if (bareme) {
    if (hauteurCm <= bareme[0].hauteurCm) {
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
    return arrondi((L * l * Math.min(hauteurCm, H)) / 1000);
  }

  if (cfg.formeCuve === 'CYLINDRE_COUCHE') {
    const d = num(cfg.cuveDiametreCm); const L = num(cfg.cuveLongueurCm);
    if (!d || !L) return null;
    return arrondi((aireSegment(d / 2, hauteurCm) * L) / 1000);
  }

  return null;
}

export function volumeMaxLitres(cfg: ConfigCuve): number | null {
  const max = hauteurMaxCm(cfg);
  return max == null ? null : litresPourHauteur(cfg, max);
}

export function cuveCalculable(cfg: ConfigCuve): boolean {
  return volumeMaxLitres(cfg) != null;
}
