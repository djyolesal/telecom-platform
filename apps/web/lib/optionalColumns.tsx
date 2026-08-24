import type { Column } from '@/components/shared/DataTable';
import { fmtDate, fmtNumber, fmtFCFA } from '@/lib/utils';

/**
 * Registre des colonnes OPTIONNELLES par tableau : masquées par défaut,
 * activables par chaque utilisateur via le sélecteur « Colonnes ».
 * L'administrateur choisit lesquelles sont proposées (Administration →
 * Colonnes des tableaux) ; la sélection est stockée dans SystemSettings
 * (web.colonnesOptionnelles.<table>) et servie par /config (null = toutes).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ColonneOptionnelle = Column<any> & { description: string };

export interface SiteOptionnel {
  latitude?: number | string | null;
  longitude?: number | string | null;
  groupes?: { numero: number; marque?: string | null }[];
  hasGardien?: boolean | null;
  societeGardiennage?: string | null;
  telephoneSite?: string | null;
  typePylone?: string | null;
  cuveVolumeLitres?: number | string | null;
}

export interface MaintenanceOptionnelle {
  site?: { region?: string };
  dateDebut?: string | null;
  dateFin?: string | null;
  dureeMinutes?: number | null;
}

export interface DepotageOptionnel {
  site?: { region?: string };
  technicien?: { nom: string; prenom: string } | null;
  numeroBonLivraison?: string | null;
  stockAvantLitres?: number | string | null;
  coutTotal?: number | string | null;
}

const fmtDuree = (min?: number | null) =>
  min == null ? '—' : min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60}` : ''}`;

const COLONNES_SITES: ColonneOptionnelle[] = [
  {
    key: 'gps', header: 'Coordonnées GPS', description: 'Latitude / longitude du site', sortable: false,
    render: (s: SiteOptionnel) =>
      s.latitude != null && s.longitude != null ? (
        <span className="font-mono text-xs text-gray-500">{Number(s.latitude).toFixed(5)}, {Number(s.longitude).toFixed(5)}</span>
      ) : ('—'),
  },
  {
    key: 'marqueGE', header: 'Marque GE', description: 'Marque des groupes électrogènes du site',
    // La marque vit sur les groupes (relation multiple) : pas de tri serveur possible.
    sortable: false,
    sortValue: (s: SiteOptionnel) => s.groupes?.find((g) => g.marque)?.marque ?? null,
    render: (s: SiteOptionnel) => {
      const marques = (s.groupes ?? []).map((g) => g.marque).filter((m): m is string => !!m);
      return marques.length ? [...new Set(marques)].join(' / ') : '—';
    },
  },
  {
    key: 'gardiennage', header: 'Gardiennage', description: 'Présence d’un gardien et société de gardiennage',
    sortValue: (s: SiteOptionnel) => (s.hasGardien ? s.societeGardiennage ?? 'Oui' : 'Non'),
    render: (s: SiteOptionnel) =>
      s.hasGardien ? <span className="text-gray-700">{s.societeGardiennage ?? 'Oui'}</span> : <span className="text-gray-400">Non</span>,
  },
  {
    key: 'telephoneSite', header: 'Téléphone site', description: 'Numéro de téléphone du site',
    render: (s: SiteOptionnel) =>
      s.telephoneSite ? (
        <a href={`tel:${s.telephoneSite}`} onClick={(e) => e.stopPropagation()} className="text-[#2471A3] hover:underline">{s.telephoneSite}</a>
      ) : ('—'),
  },
  { key: 'typePylone', header: 'Type de pylône', description: 'Référentiel des types de pylône', render: (s: SiteOptionnel) => s.typePylone ?? '—' },
  {
    key: 'cuveVolumeLitres', header: 'Cuve (L)', description: 'Capacité de la cuve à gasoil', align: 'right',
    render: (s: SiteOptionnel) => (s.cuveVolumeLitres != null ? fmtNumber(Number(s.cuveVolumeLitres)) : '—'),
  },
];

const COLONNES_MAINTENANCES: ColonneOptionnelle[] = [
  {
    key: 'region', header: 'Région', description: 'Région du site concerné',
    sortValue: (m: MaintenanceOptionnelle) => m.site?.region, render: (m: MaintenanceOptionnelle) => m.site?.region ?? '—',
  },
  { key: 'dateDebut', header: 'Début réel', description: 'Date de démarrage effectif de l’intervention', render: (m: MaintenanceOptionnelle) => fmtDate(m.dateDebut) },
  { key: 'dateFin', header: 'Fin réelle', description: 'Date de clôture de l’intervention', render: (m: MaintenanceOptionnelle) => fmtDate(m.dateFin) },
  {
    key: 'dureeMinutes', header: 'Durée', description: 'Durée travaillée (hors suspension)', align: 'right',
    render: (m: MaintenanceOptionnelle) => fmtDuree(m.dureeMinutes),
  },
];

const COLONNES_DEPOTAGES: ColonneOptionnelle[] = [
  {
    key: 'region', header: 'Région', description: 'Région du site livré',
    sortValue: (d: DepotageOptionnel) => d.site?.region, render: (d: DepotageOptionnel) => d.site?.region ?? '—',
  },
  {
    key: 'technicien', header: 'Technicien', description: 'Technicien ayant réalisé le dépotage',
    sortValue: (d: DepotageOptionnel) => d.technicien?.nom,
    render: (d: DepotageOptionnel) => (d.technicien ? `${d.technicien.prenom} ${d.technicien.nom}` : '—'),
  },
  {
    key: 'numeroBonLivraison', header: 'N° BL', description: 'Numéro du bon de livraison',
    render: (d: DepotageOptionnel) => d.numeroBonLivraison ? <span className="font-mono text-xs text-gray-500">{d.numeroBonLivraison}</span> : '—',
  },
  {
    key: 'stockAvantLitres', header: 'Stock avant (L)', description: 'Jauge relevée avant dépotage', align: 'right',
    render: (d: DepotageOptionnel) => (d.stockAvantLitres != null ? fmtNumber(Number(d.stockAvantLitres)) : '—'),
  },
  {
    key: 'coutTotal', header: 'Coût total', description: 'Coût de la livraison (FCFA)', align: 'right',
    render: (d: DepotageOptionnel) => (d.coutTotal != null ? fmtFCFA(Number(d.coutTotal)) : '—'),
  },
];

export type TableOptionnelle = 'sites' | 'maintenances' | 'depotages';

export const COLONNES_OPTIONNELLES: Record<TableOptionnelle, { titre: string; colonnes: ColonneOptionnelle[] }> = {
  sites: { titre: 'Liste des sites', colonnes: COLONNES_SITES },
  maintenances: { titre: 'Liste des maintenances', colonnes: COLONNES_MAINTENANCES },
  depotages: { titre: 'Liste des dépotages', colonnes: COLONNES_DEPOTAGES },
};
