'use client';

import { useState } from 'react';
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

export default function IncidentsPage() {
  const { options: typesOptions, labelDe } = useTypesIncident();
  // L'export est refusé au TECHNICIEN (rbac serveur) : bouton masqué.
  const { data: sessionExp } = useSession();
  const roleExport = (sessionExp?.user as { role?: string })?.role ?? '';
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [type, setType] = useState('');
  const [severite, setSeverite] = useState('');
  const [statut, setStatut] = useState('');
  const [region, setRegion] = useState('');
  // Tri d'en-tête délégué au serveur (pagination serveur : un tri local ne
  // réordonnerait que la page affichée). null = tri métier par défaut.
  const [tri, setTri] = useState<{ key: string; dir: 1 | -1 } | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['incidents', { page, type, severite, statut, region, tri }],
    queryFn: () =>
      api.get('/incidents', { params: {
        page, limit: 20, type: type || undefined, severite: severite || undefined, statut: statut || undefined, region: region || undefined,
        tri: tri?.key, sens: tri ? (tri.dir === 1 ? 'asc' : 'desc') : undefined,
      } }).then((r) => r.data),
  });

  const rows: Incident[] = data?.data ?? [];
  const meta: PaginationMeta | undefined = data?.meta;

  const columns: Column<Incident>[] = [
    { key: 'reference', header: 'Réf.', render: (x: { reference?: string | null }) => <span className="font-mono text-xs text-gray-500">{x.reference ?? '—'}</span> },
    { key: 'site', header: 'Site', render: (i) => <span className="font-medium text-gray-800">{i.site?.nom ?? "—"}</span> },
    { key: 'type', header: 'Type', render: (i) => labelDe(i.type) },
    { key: 'severite', header: 'Sévérité', render: (i) => <SeveriteBadge value={i.severite} /> },
    { key: 'statut', header: 'Statut', render: (i) => <StatutIncidentBadge value={i.statut} /> },
    { key: 'technicien', header: 'Technicien', render: (i) => (i.technicien ? `${i.technicien.prenom} ${i.technicien.nom}` : '—') },
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
        filters={[
          { key: 'type', label: 'Tous types', value: type, options: typesOptions, onChange: (v) => { setType(v); setPage(1); } },
          { key: 'severite', label: 'Toutes sévérités', value: severite, options: SEVERITES, onChange: (v) => { setSeverite(v); setPage(1); } },
          { key: 'statut', label: 'Tous statuts', value: statut, options: STATUTS_INCIDENT, onChange: (v) => { setStatut(v); setPage(1); } },
          { key: 'region', label: 'Toutes régions', value: region, options: regionOptions, onChange: (v) => { setRegion(v); setPage(1); } },
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
            serverSort={tri} onServerSort={(s) => { setTri(s); setPage(1); }} />
          <Pagination meta={meta} onChange={setPage} />
        </>
      )}
    </div>
  );
}
