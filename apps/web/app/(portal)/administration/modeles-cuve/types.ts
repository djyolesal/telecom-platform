import type { PointBaremage, SourceCuve } from '@/lib/cuve';

export interface ModeleCuve {
  id: string;
  nom: string;
  capaciteLitres: number;
  formeCuve: 'RECTANGULAIRE' | 'CYLINDRE_COUCHE' | null;
  longueurCm: number | null;
  largeurCm: number | null;
  hauteurCm: number | null;
  diametreCm: number | null;
  description: string | null;
  isActive: boolean;
  nbPoints: number;
  nbSites: number;
  calculable: boolean;
  conversion: 'BAREME' | 'DIMENSIONS' | null;
  hauteurMaxCm: number | null;
  volumeMaxLitres: number | null;
  ecartCapacitePct: number | null;
  baremage?: PointBaremage[];
}

export interface SitePourModele {
  id: string;
  nom: string;
  region: string;
  sansGE: boolean;
  capaciteLitres: number | null;
  modeleCuveId: string | null;
  source: SourceCuve | null;
  pointsBaremePropre: number;
}

/** Libellé court de la conversion d'un modèle. */
export function libelleConversion(m: Pick<ModeleCuve, 'conversion' | 'nbPoints'>): string {
  if (m.conversion === 'BAREME') return `Barème, ${m.nbPoints.toLocaleString('fr-FR')} points`;
  if (m.conversion === 'DIMENSIONS') return 'Dimensions intérieures';
  return 'Non calculable';
}
