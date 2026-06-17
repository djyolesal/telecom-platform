'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Plus, Download, CalendarDays } from 'lucide-react';
import { api } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { PageHeader } from '@/components/shared/PageHeader';
import { FilterBar } from '@/components/shared/FilterBar';
import { DataTable, Column } from '@/components/shared/DataTable';
import { Pagination, PaginationMeta } from '@/components/shared/Pagination';
import { TableSkeleton, EmptyState, ErrorState } from '@/components/shared/states';
import { ButtonLink } from '@/components/shared/Button';
import { StatutMaintBadge } from '@/components/shared/Badge';
import { TYPES_MAINTENANCE, STATUTS_MAINTENANCE, CATEGORIES_EQUIPEMENT } from '@/lib/constants';
import { fmtDateTime } from '@/lib/utils';

interface Maintenance {
  id: string;
  equipement: string;
  type: string;
  categorie: string;
  statut: string;
  datePlanifiee: string;
  site?: { code: string; region: string };
  technicien?: { nom: string; prenom: string };
  prestataire?: { id: string; nom: string };
}

export default function MaintenancePage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [type, setType] = useState('');
  const [statut, setStatut] = useState('');
  const [prestataireId, setPrestataireId] = useState('');

  const { data: prestataires } = useQuery({
    queryKey: ['prestataires-select'],
    queryFn: () => api.get('/prestataires', { params: { is_active: true, limit: 200 } }).then((r) => r.data.data),
  });
  const prestataireOptions = (prestataires ?? []).map((p: { id: string; nom: string }) => ({ value: p.id, label: p.nom }));

  const { data, isLoading, isError } = useQuery({
    queryKey: ['maintenances', { page, type, statut, prestataireId }],
    queryFn: () =>
      api.get('/maintenances', { params: { page, limit: 20, type: type || undefined, statut: statut || undefined, prestataire_id: prestataireId || undefined } }).then((r) => r.data),
  });

  const rows: Maintenance[] = data?.data ?? [];
  const meta: PaginationMeta | undefined = data?.meta;

  const columns: Column<Maintenance>[] = [
    { key: 'site', header: 'Site', render: (m) => <span className="font-medium text-gray-800">{m.site?.code ?? '—'}</span> },
    { key: 'equipement', header: 'Équipement' },
    { key: 'type', header: 'Type', render: (m) => TYPES_MAINTENANCE.find((t) => t.value === m.type)?.label ?? m.type },
    { key: 'categorie', header: 'Catégorie', render: (m) => CATEGORIES_EQUIPEMENT.find((c) => c.value === m.categorie)?.label ?? m.categorie },
    { key: 'prestataire', header: 'Prestataire', render: (m) => m.prestataire?.nom ?? '—' },
    { key: 'statut', header: 'Statut', render: (m) => <StatutMaintBadge value={m.statut} /> },
    { key: 'technicien', header: 'Technicien', render: (m) => (m.technicien ? `${m.technicien.prenom} ${m.technicien.nom}` : '—') },
    { key: 'datePlanifiee', header: 'Planifiée', render: (m) => fmtDateTime(m.datePlanifiee) },
  ];

  return (
    <div>
      <PageHeader
        title="Maintenances"
        actions={
          <>
            <ButtonLink href="/maintenance/planning" variant="secondary" icon={CalendarDays}>Planning</ButtonLink>
            <button type="button" onClick={() => downloadFile('/maintenances/export/xlsx', 'maintenances.xlsx')} className="inline-flex items-center gap-2 rounded-lg bg-white border border-gray-200 px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              <Download size={15} /> Export
            </button>
            <ButtonLink href="/maintenance/nouveau" icon={Plus}>Planifier</ButtonLink>
          </>
        }
      />

      <FilterBar
        filters={[
          { key: 'type', label: 'Tous types', value: type, options: TYPES_MAINTENANCE, onChange: (v) => { setType(v); setPage(1); } },
          { key: 'statut', label: 'Tous statuts', value: statut, options: STATUTS_MAINTENANCE, onChange: (v) => { setStatut(v); setPage(1); } },
          { key: 'prestataire', label: 'Tous prestataires', value: prestataireId, options: prestataireOptions, onChange: (v) => { setPrestataireId(v); setPage(1); } },
        ]}
      />

      {isLoading ? (
        <TableSkeleton cols={7} />
      ) : isError ? (
        <ErrorState />
      ) : rows.length === 0 ? (
        <EmptyState title="Aucune maintenance" />
      ) : (
        <>
          <DataTable columns={columns} data={rows} onRowClick={(m) => router.push(`/maintenance/${m.id}`)} />
          <Pagination meta={meta} onChange={setPage} />
        </>
      )}
    </div>
  );
}
