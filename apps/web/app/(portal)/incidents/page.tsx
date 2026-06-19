'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Plus, Download, BarChart3 } from 'lucide-react';
import { api } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { PageHeader } from '@/components/shared/PageHeader';
import { FilterBar } from '@/components/shared/FilterBar';
import { DataTable, Column } from '@/components/shared/DataTable';
import { Pagination, PaginationMeta } from '@/components/shared/Pagination';
import { TableSkeleton, EmptyState, ErrorState } from '@/components/shared/states';
import { ButtonLink } from '@/components/shared/Button';
import { SeveriteBadge, StatutIncidentBadge } from '@/components/shared/Badge';
import { TYPES_INCIDENT, SEVERITES, STATUTS_INCIDENT, regionOptions } from '@/lib/constants';
import { fmtDateTime } from '@/lib/utils';

interface Incident {
  id: string;
  type: string;
  severite: string;
  statut: string;
  dateOuverture: string;
  site?: { code: string; nom: string; region: string };
  technicien?: { nom: string; prenom: string };
}

export default function IncidentsPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [type, setType] = useState('');
  const [severite, setSeverite] = useState('');
  const [statut, setStatut] = useState('');
  const [region, setRegion] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['incidents', { page, type, severite, statut, region }],
    queryFn: () =>
      api.get('/incidents', { params: { page, limit: 20, type: type || undefined, severite: severite || undefined, statut: statut || undefined, region: region || undefined } }).then((r) => r.data),
  });

  const rows: Incident[] = data?.data ?? [];
  const meta: PaginationMeta | undefined = data?.meta;

  const columns: Column<Incident>[] = [
    { key: 'site', header: 'Site', render: (i) => <span className="font-medium text-gray-800">{i.site?.nom ?? i.site?.code ?? "—"}</span> },
    { key: 'type', header: 'Type', render: (i) => TYPES_INCIDENT.find((t) => t.value === i.type)?.label ?? i.type },
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
            <button type="button" onClick={() => downloadFile('/incidents/export/xlsx', 'incidents.xlsx')} className="inline-flex items-center gap-2 rounded-lg bg-white border border-gray-200 px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              <Download size={15} /> Export
            </button>
            <ButtonLink href="/incidents/nouveau" icon={Plus}>Déclarer</ButtonLink>
          </>
        }
      />

      <FilterBar
        filters={[
          { key: 'type', label: 'Tous types', value: type, options: TYPES_INCIDENT, onChange: (v) => { setType(v); setPage(1); } },
          { key: 'severite', label: 'Sévérité', value: severite, options: SEVERITES, onChange: (v) => { setSeverite(v); setPage(1); } },
          { key: 'statut', label: 'Statut', value: statut, options: STATUTS_INCIDENT, onChange: (v) => { setStatut(v); setPage(1); } },
          { key: 'region', label: 'Région', value: region, options: regionOptions, onChange: (v) => { setRegion(v); setPage(1); } },
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
          <DataTable columns={columns} data={rows} onRowClick={(i) => router.push(`/incidents/${i.id}`)} />
          <Pagination meta={meta} onChange={setPage} />
        </>
      )}
    </div>
  );
}
