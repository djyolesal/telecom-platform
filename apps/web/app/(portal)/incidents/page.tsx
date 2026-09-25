'use client';

import { useEffect, useState, Suspense } from 'react';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { useFiltresUrl } from '@/lib/hooks/useFiltresUrl';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Plus, Download, BarChart3 } from 'lucide-react';
import { api } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { ExportButtons } from '@/components/shared/ExportButtons';
import { PageHeader } from '@/components/shared/PageHeader';
import { FilterBar } from '@/components/shared/FilterBar';
import { DataTable, Column } from '@/components/shared/DataTable';
import { Pagination, PaginationMeta } from '@/components/shared/Pagination';
import { TableSkeleton, EmptyState, ErrorState } from '@/components/shared/states';
import { ButtonLink } from '@/components/shared/Button';
import { SeveriteBadge, StatutIncidentBadge } from '@/components/shared/Badge';
import { SEVERITES, STATUTS_INCIDENT, regionOptions } from '@/lib/constants';
import { useTypesIncident } from '@/lib/typesIncident';
import { fmtDateTime } from '@/lib/utils';

interface Incident {
  id: string;
  reference?: string | null;
  type: string;
  severite: string;
  statut: string;
  dateOuverture: string;
  site?: { code: string; nom: string; region: string };
  technicien?: { nom: string; prenom: string };
}

const FILTRES_DEFAUT = { page: '1', search: '', type: '', severite: '', statut: '', region: '', tri: '', sens: '' };

function IncidentsPageInner() {
  const { options: typesOptions, labelDe } = useTypesIncident();
  // L'export est refusé au TECHNICIEN (rbac serveur) : bouton masqué.
  const { data: sessionExp } = useSession();
  const roleExport = (sessionExp?.user as { role?: string })?.role ?? '';
  const router = useRouter();
  // Filtres dans l'URL : ouvrir un incident puis revenir ne doit pas effacer
  // le tri et les filtres — et un lien filtré se partage tel quel.
  const { valeurs, appliquer } = useFiltresUrl(FILTRES_DEFAUT);
  const page = Number(valeurs.page) || 1;
  const setPage = (p: number) => appliquer({ page: String(p) });
  const { type, severite, statut, region } = valeurs;
  // La saisie reste locale (réactive à la frappe) ; seule sa version
  // debouncée rejoint l'URL, sinon chaque caractère réécrirait l'adresse.
  const [search, setSearch] = useState(valeurs.search);
  const debouncedSearch = useDebounce(search);
  useEffect(() => {
    if (debouncedSearch !== valeurs.search) appliquer({ search: debouncedSearch, page: '1' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);
  // Tri d'en-tête délégué au serveur (pagination serveur : un tri local ne
  // réordonnerait que la page affichée). Vide = tri métier par défaut.
  const tri = valeurs.tri ? { key: valeurs.tri, dir: (valeurs.sens === 'desc' ? -1 : 1) as 1 | -1 } : null;

  const { data, isLoading, isError } = useQuery({
    queryKey: ['incidents', { page, search: debouncedSearch, type, severite, statut, region, tri }],
    queryFn: () =>
      api.get('/incidents', { params: {
        page, limit: 20, search: debouncedSearch || undefined, type: type || undefined, severite: severite || undefined, statut: statut || undefined, region: region || undefined,
        tri: tri?.key, sens: tri ? (tri.dir === 1 ? 'asc' : 'desc') : undefined,
      } }).then((r) => r.data),
  });

  const rows: Incident[] = data?.data ?? [];
  const meta: PaginationMeta | undefined = data?.meta;

  const columns: Column<Incident>[] = [
    { key: 'reference', header: 'Réf.', render: (x: { reference?: string | null }) => <span className="font-mono text-xs text-gray-500">{x.reference ?? '-'}</span> },
    { key: 'site', header: 'Site', render: (i) => <span className="font-medium text-gray-800">{i.site?.nom ?? "-"}</span> },
    { key: 'type', header: 'Type', render: (i) => labelDe(i.type) },
    { key: 'severite', header: 'Sévérité', render: (i) => <SeveriteBadge value={i.severite} /> },
    { key: 'statut', header: 'Statut', render: (i) => <StatutIncidentBadge value={i.statut} /> },
    { key: 'technicien', header: 'Technicien', render: (i) => (i.technicien ? `${i.technicien.prenom} ${i.technicien.nom}` : '-') },
    { key: 'dateOuverture', header: 'Ouverture', render: (i) => fmtDateTime(i.dateOuverture) },
  ];

  return (
    <div>
      <PageHeader
        title="Incidents"
        actions={
          <>
            <ButtonLink href="/incidents/kpis" variant="secondary" icon={BarChart3}>KPIs</ButtonLink>
            {roleExport !== 'TECHNICIEN' && <ExportButtons base="/incidents/export" name="incidents"/>}
            <ButtonLink href="/incidents/nouveau" icon={Plus}>Déclarer</ButtonLink>
          </>
        }
      />

      <FilterBar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Rechercher (réf., site, description)…"
        filters={[
          { key: 'type', label: 'Tous types', value: type, options: typesOptions, onChange: (v) => appliquer({ type: v, page: '1' }) },
          { key: 'severite', label: 'Toutes sévérités', value: severite, options: SEVERITES, onChange: (v) => appliquer({ severite: v, page: '1' }) },
          { key: 'statut', label: 'Tous statuts', value: statut, options: STATUTS_INCIDENT, onChange: (v) => appliquer({ statut: v, page: '1' }) },
          { key: 'region', label: 'Toutes régions', value: region, options: regionOptions, onChange: (v) => appliquer({ region: v, page: '1' }) },
        ]}
      />

      {isLoading ? (
        <TableSkeleton cols={6} />
      ) : isError ? (
        <ErrorState />
      ) : rows.length === 0 ? (
        <EmptyState title="Aucun incident" />
      ) : (
        <>
          <DataTable columns={columns} data={rows} onRowClick={(i) => router.push(`/incidents/${i.id}`)}
            serverSort={tri}
            onServerSort={(s) => appliquer({ tri: s?.key ?? '', sens: s && s.dir === -1 ? 'desc' : '', page: '1' })} />
          <Pagination meta={meta} onChange={setPage} />
        </>
      )}
    </div>
  );
}

/**
 * Les filtres vivent dans la query (useFiltresUrl) : Next exige alors une
 * frontière Suspense, sinon le prérendu de la page échoue à la construction.
 */
export default function IncidentsPage() {
  return (
    <Suspense fallback={<TableSkeleton cols={6} />}>
      <IncidentsPageInner />
    </Suspense>
  );
}
