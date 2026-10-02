'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Boxes, Wrench, MapPin, PackageX } from 'lucide-react';
import { api } from '@/lib/api';
import { ExportButtons } from '@/components/shared/ExportButtons';
import { PageHeader } from '@/components/shared/PageHeader';
import { FilterBar } from '@/components/shared/FilterBar';
import { StatCard } from '@/components/shared/StatCard';
import { DataTable, Column } from '@/components/shared/DataTable';
import { Pagination, PaginationMeta } from '@/components/shared/Pagination';
import { Badge } from '@/components/shared/Badge';
import { TableSkeleton, EmptyState, ErrorState } from '@/components/shared/states';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { useFiltresUrl } from '@/lib/hooks/useFiltresUrl';
import { fmtNumber, fmtDate } from '@/lib/utils';

interface LignePiece {
  id: string;
  nom: string;
  reference: string | null;
  quantite: number;
  catalogue: { id: string; code: string; libelle: string } | null;
  date: string;
  invalidee: boolean;
  maintenance: { id: string; reference: string | null; type: string; statut: string };
  // `code` n'est servi par l'API qu'à l'ADMIN : jamais supposé présent.
  site: { id: string; nom: string; region: string; code?: string };
  prestataire: { id: string; nom: string } | null;
  technicien: string | null;
}

interface PieceSynthese {
  cle: string;
  libelle: string;
  catalogue: boolean;
  quantite: number;
  interventions: number;
  sites: number;
}

interface Synthese {
  partielle: boolean;
  totaux: { lignes: number; quantite: number; interventions: number; sites: number; sansCatalogue: number };
  parPiece: PieceSynthese[];
}

const TYPES = [
  { value: 'PREVENTIVE', label: 'Préventive' },
  { value: 'CURATIVE', label: 'Curative' },
];
const CATALOGUE = [
  { value: 'oui', label: 'Au catalogue' },
  { value: 'non', label: 'Hors catalogue' },
];

// Constante de module et SANS date : calculer « ce mois » ici figerait la valeur
// à la construction du site (le prérendu évalue ce module), et l'URL ne
// resterait propre que pour un jour. Les raccourcis de période posent des dates
// explicites au clic.
const FILTRES_DEFAUT = {
  page: '1', search: '', debut: '', fin: '', type: '', catalogue: '', prestataireId: '', invalidees: '',
};

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Bornes d'un raccourci de période, calculées au clic (côté navigateur seulement). */
function periode(cle: 'mois' | 'precedent' | 'trois'): { debut: string; fin: string } {
  const now = new Date();
  const an = now.getFullYear();
  const mois = now.getMonth();
  if (cle === 'mois') return { debut: iso(new Date(an, mois, 1)), fin: iso(now) };
  if (cle === 'precedent') return { debut: iso(new Date(an, mois - 1, 1)), fin: iso(new Date(an, mois, 0)) };
  return { debut: iso(new Date(an, mois - 2, 1)), fin: iso(now) };
}

const champDate =
  'rounded-lg border border-gray-200 px-3 py-2 text-sm bg-white focus:border-[rgb(var(--brand-light))] outline-none';
const raccourci =
  'rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50';

function PiecesChangeesInner() {
  const router = useRouter();
  // Filtres dans l'URL : ouvrir une intervention puis revenir ne les efface pas,
  // et une vue filtrée se partage par simple copie du lien.
  const { valeurs, appliquer, reinitialiser } = useFiltresUrl(FILTRES_DEFAUT);
  const page = Number(valeurs.page) || 1;
  const { debut, fin, type, catalogue, prestataireId, invalidees } = valeurs;

  const [search, setSearch] = useState(valeurs.search);
  const debouncedSearch = useDebounce(search);
  useEffect(() => {
    if (debouncedSearch !== valeurs.search) appliquer({ search: debouncedSearch, page: '1' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const { data: prestataires } = useQuery({
    queryKey: ['prestataires-select'],
    queryFn: () => api.get('/prestataires', { params: { is_active: true, limit: 200 } }).then((r) => r.data.data),
  });
  const prestataireOptions = (prestataires ?? []).map((p: { id: string; nom: string }) => ({ value: p.id, label: p.nom }));

  // MÊMES paramètres pour l'écran et l'export : ce qu'on télécharge est ce qu'on voit.
  const filtres = {
    search: debouncedSearch || undefined,
    date_debut: debut || undefined,
    date_fin: fin || undefined,
    type: type || undefined,
    catalogue: catalogue || undefined,
    prestataire_id: prestataireId || undefined,
    inclure_invalidees: invalidees === '1' ? '1' : undefined,
  };
  const exportQuery = new URLSearchParams(
    Object.entries(filtres).filter(([, v]) => v != null) as [string, string][],
  ).toString();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['pieces-changees', { page, ...filtres }],
    queryFn: () => api.get('/pieces-changees', { params: { page, limit: 50, ...filtres } }).then((r) => r.data as {
      data: LignePiece[]; meta: PaginationMeta; synthese: Synthese;
    }),
    // Changer de page ne doit pas faire clignoter la synthèse ni les totaux.
    placeholderData: keepPreviousData,
  });

  const rows = data?.data ?? [];
  const meta = data?.meta;
  const syn = data?.synthese;
  const filtreActif = !!(debouncedSearch || debut || fin || type || catalogue || prestataireId || invalidees);

  const colsSynthese: Column<PieceSynthese>[] = [
    {
      key: 'libelle', header: 'Pièce',
      render: (p) => (
        <span className="flex items-center gap-2">
          <span className="font-medium text-gray-800">{p.libelle}</span>
          {!p.catalogue && <Badge className="bg-amber-50 text-amber-700">Hors catalogue</Badge>}
        </span>
      ),
    },
    { key: 'quantite', header: 'Quantité', align: 'right', render: (p) => <span className="font-semibold">{fmtNumber(p.quantite)}</span> },
    { key: 'interventions', header: 'Interventions', align: 'right', render: (p) => fmtNumber(p.interventions) },
    { key: 'sites', header: 'Sites', align: 'right', render: (p) => fmtNumber(p.sites) },
  ];

  const colsDetail: Column<LignePiece>[] = [
    { key: 'date', header: 'Date', render: (l) => fmtDate(l.date), sortValue: (l) => l.date },
    {
      key: 'site', header: 'Site', sortValue: (l) => l.site.nom,
      render: (l) => (
        <span>
          <span className="font-medium text-gray-800">{l.site.nom}</span>
          {/* Le code n'est servi qu'à l'ADMIN : présent => on l'affiche. */}
          {l.site.code && <span className="ml-1.5 font-mono text-[11px] text-gray-400">{l.site.code}</span>}
          <span className="block text-[11px] text-gray-400">{l.site.region}</span>
        </span>
      ),
    },
    { key: 'prestataire', header: 'Prestataire', sortValue: (l) => l.prestataire?.nom ?? '', render: (l) => l.prestataire?.nom ?? <span className="text-gray-400">-</span> },
    {
      key: 'intervention', header: 'Intervention', sortValue: (l) => l.maintenance.reference ?? '',
      render: (l) => (
        <span>
          <span className="font-mono text-xs text-gray-500">{l.maintenance.reference ?? '-'}</span>
          <span className="block text-[11px] text-gray-400">{l.maintenance.type === 'CURATIVE' ? 'Curative' : 'Préventive'}</span>
        </span>
      ),
    },
    {
      key: 'nom', header: 'Pièce', sortValue: (l) => l.nom,
      render: (l) => (
        <span>
          <span className="text-gray-800">{l.nom}</span>
          {l.reference && <span className="ml-1.5 font-mono text-[11px] text-gray-400">{l.reference}</span>}
          {l.catalogue
            ? l.catalogue.libelle !== l.nom && <span className="block text-[11px] text-gray-400">Catalogue : {l.catalogue.libelle}</span>
            : <span className="mt-0.5 block"><Badge className="bg-amber-50 text-amber-700">Hors catalogue</Badge></span>}
          {l.invalidee && <span className="mt-0.5 block"><Badge className="bg-red-50 text-red-700">Intervention invalidée</Badge></span>}
        </span>
      ),
    },
    { key: 'quantite', header: 'Qté', align: 'right', render: (l) => <span className="font-semibold">{l.quantite}</span> },
    { key: 'technicien', header: 'Technicien', sortValue: (l) => l.technicien ?? '', render: (l) => l.technicien ?? <span className="text-gray-400">-</span> },
  ];

  return (
    <div>
      <PageHeader
        title="Pièces changées"
        subtitle="Pièces de rechange posées lors des interventions"
        actions={<ExportButtons base="/pieces-changees/export" name="pieces-changees" query={exportQuery} />}
      />

      <FilterBar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Rechercher (pièce, référence, site, intervention)…"
        filters={[
          { key: 'type', label: 'Tous types', value: type, options: TYPES, onChange: (v) => appliquer({ type: v, page: '1' }) },
          { key: 'catalogue', label: 'Catalogue : tout', value: catalogue, options: CATALOGUE, onChange: (v) => appliquer({ catalogue: v, page: '1' }) },
          { key: 'prestataire', label: 'Tous prestataires', value: prestataireId, options: prestataireOptions, onChange: (v) => appliquer({ prestataireId: v, page: '1' }) },
        ]}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-gray-500">
          Du
          <input type="date" value={debut} max={fin || undefined} className={champDate}
            onChange={(e) => appliquer({ debut: e.target.value, page: '1' })} />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-500">
          au
          <input type="date" value={fin} min={debut || undefined} className={champDate}
            onChange={(e) => appliquer({ fin: e.target.value, page: '1' })} />
        </label>
        <button type="button" className={raccourci} onClick={() => { const p = periode('mois'); appliquer({ debut: p.debut, fin: p.fin, page: '1' }); }}>Ce mois</button>
        <button type="button" className={raccourci} onClick={() => { const p = periode('precedent'); appliquer({ debut: p.debut, fin: p.fin, page: '1' }); }}>Mois précédent</button>
        <button type="button" className={raccourci} onClick={() => { const p = periode('trois'); appliquer({ debut: p.debut, fin: p.fin, page: '1' }); }}>3 derniers mois</button>
        <label className="ml-2 flex items-center gap-1.5 text-xs text-gray-600">
          <input type="checkbox" checked={invalidees === '1'} className="h-4 w-4 rounded border-gray-300"
            onChange={(e) => appliquer({ invalidees: e.target.checked ? '1' : '', page: '1' })} />
          Inclure les interventions invalidées
        </label>
        {filtreActif && (
          <button type="button" className="ml-auto text-xs font-medium text-[rgb(var(--brand-light))] hover:underline"
            onClick={() => { setSearch(''); reinitialiser(); }}>
            Réinitialiser les filtres
          </button>
        )}
      </div>

      {isLoading ? (
        <TableSkeleton cols={7} />
      ) : isError || !syn ? (
        <ErrorState />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatCard title="Pièces posées" value={fmtNumber(syn.totaux.quantite)} subtitle={`${fmtNumber(syn.totaux.lignes)} ligne(s)`} icon={Boxes} />
            <StatCard title="Interventions" value={fmtNumber(syn.totaux.interventions)} icon={Wrench} color="bg-indigo-500" />
            <StatCard title="Sites" value={fmtNumber(syn.totaux.sites)} icon={MapPin} color="bg-emerald-500" />
            <StatCard
              title="Hors catalogue" value={fmtNumber(syn.totaux.sansCatalogue)}
              subtitle={syn.totaux.sansCatalogue > 0 ? 'saisies libres, non agrégeables' : 'tout est rattaché'}
              icon={PackageX} color={syn.totaux.sansCatalogue > 0 ? 'bg-amber-500' : 'bg-gray-400'}
            />
          </div>

          {syn.partielle && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
              Volume très élevé : la synthèse ne porte que sur les premières lignes. Réduisez la période pour un total exact.
            </div>
          )}

          {rows.length === 0 ? (
            <EmptyState
              title="Aucune pièce sur ce filtre"
              hint={filtreActif ? 'Élargissez la période ou retirez un filtre.' : 'Aucune pièce de rechange n\'a encore été enregistrée.'}
            />
          ) : (
            <>
              <h2 className="mb-2 text-sm font-semibold text-gray-700">Par pièce</h2>
              <div className="mb-6">
                <DataTable columns={colsSynthese} data={syn.parPiece} rowKey={(p) => p.cle} />
              </div>

              <h2 className="mb-2 text-sm font-semibold text-gray-700">Détail</h2>
              <DataTable columns={colsDetail} data={rows} rowKey={(l) => l.id}
                onRowClick={(l) => router.push(`/maintenance/${l.maintenance.id}`)} />
              <Pagination meta={meta} onChange={(p) => appliquer({ page: String(p) })} />
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Les filtres vivent dans la query (useFiltresUrl) : Next exige alors une
 * frontière Suspense, sinon le prérendu de la page échoue à la construction.
 */
export default function PiecesChangeesPage() {
  return (
    <Suspense fallback={<TableSkeleton cols={7} />}>
      <PiecesChangeesInner />
    </Suspense>
  );
}
