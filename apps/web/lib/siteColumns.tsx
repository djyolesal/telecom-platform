import type { Column } from '@/components/shared/DataTable';

/** Champs optionnels d'un site affichables dans la liste. */
export interface SiteOptionnel {
  latitude?: number | string | null;
  longitude?: number | string | null;
  marqueGE?: string | null;
  marqueGE2?: string | null;
  hasGardien?: boolean | null;
  societeGardiennage?: string | null;
  telephoneSite?: string | null;
  typePylone?: string | null;
  cuveVolumeLitres?: number | string | null;
}

/**
 * Catalogue des colonnes OPTIONNELLES de la liste des sites : masquées par
 * défaut, activables par chaque utilisateur via le sélecteur « Colonnes ».
 * L'administrateur choisit lesquelles sont proposées (Administration →
 * Colonnes des tableaux) ; la liste autorisée est servie par /config
 * (`sitesColonnesOptionnelles`, null = toutes).
 */
export const SITE_COLONNES_OPTIONNELLES: Array<Column<SiteOptionnel> & { description: string }> = [
  {
    key: 'gps',
    header: 'Coordonnées GPS',
    description: 'Latitude / longitude du site',
    sortable: false,
    render: (s) =>
      s.latitude != null && s.longitude != null ? (
        <span className="font-mono text-xs text-gray-500">
          {Number(s.latitude).toFixed(5)}, {Number(s.longitude).toFixed(5)}
        </span>
      ) : ('—'),
  },
  {
    key: 'marqueGE',
    header: 'Marque GE',
    description: 'Marque du groupe électrogène (GE2 entre parenthèses)',
    render: (s) => (s.marqueGE ? `${s.marqueGE}${s.marqueGE2 ? ` (${s.marqueGE2})` : ''}` : '—'),
  },
  {
    key: 'gardiennage',
    header: 'Gardiennage',
    description: 'Présence d’un gardien et société de gardiennage',
    sortValue: (s) => (s.hasGardien ? s.societeGardiennage ?? 'Oui' : 'Non'),
    render: (s) =>
      s.hasGardien ? (
        <span className="text-gray-700">{s.societeGardiennage ?? 'Oui'}</span>
      ) : (
        <span className="text-gray-400">Non</span>
      ),
  },
  {
    key: 'telephoneSite',
    header: 'Téléphone site',
    description: 'Numéro de téléphone du site',
    render: (s) =>
      s.telephoneSite ? (
        <a href={`tel:${s.telephoneSite}`} onClick={(e) => e.stopPropagation()} className="text-[#2471A3] hover:underline">
          {s.telephoneSite}
        </a>
      ) : ('—'),
  },
  {
    key: 'typePylone',
    header: 'Type de pylône',
    description: 'Référentiel des types de pylône',
    render: (s) => s.typePylone ?? '—',
  },
  {
    key: 'cuveVolumeLitres',
    header: 'Cuve (L)',
    description: 'Capacité de la cuve à gasoil',
    align: 'right',
    render: (s) => (s.cuveVolumeLitres != null ? Number(s.cuveVolumeLitres).toLocaleString('fr-FR') : '—'),
  },
];
