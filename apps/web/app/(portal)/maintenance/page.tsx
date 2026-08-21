'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Plus, Download, CalendarDays, Camera } from 'lucide-react';
import { api } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { ExportButtons } from '@/components/shared/ExportButtons';
import { PageHeader } from '@/components/shared/PageHeader';
import { FilterBar } from '@/components/shared/FilterBar';
import { DataTable, Column } from '@/components/shared/DataTable';
import { Pagination, PaginationMeta } from '@/components/shared/Pagination';
import { TableSkeleton, EmptyState, ErrorState } from '@/components/shared/states';
import { ButtonLink } from '@/components/shared/Button';
import { StatutMaintBadge } from '@/components/shared/Badge';
import { TYPES_MAINTENANCE, STATUTS_MAINTENANCE, CATEGORIES_EQUIPEMENT } from '@/lib/constants';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { fmtDateTime } from '@/lib/utils';

import { useColonnesOptionnelles } from '@/lib/hooks/useColonnesOptionnelles';

interface Maintenance {
  id: string;
  reference?: string | null;
  equipement: string;
  type: string;
  categorie: string;
  statut: string;
  datePlanifiee: string;
  dateDebut?: string | null;
  dateFin?: string | null;
  dureeMinutes?: number | null;
  site?: { code: string; nom: string; region: string };
  technicien?: { nom: string; prenom: string };
  prestataire?: { id: string; nom: string };
  _count?: { photos: number };
}

export default function MaintenancePage() {
  // L'export est refusé au TECHNICIEN (rbac serveur) : bouton masqué.
  const { data: sessionExp } = useSession();
  const roleExport = (sessionExp?.user as { role?: string })?.role ?? '';
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [statut, setStatut] = useState('');
  const [prestataireId, setPrestataireId] = useState('');
  const debouncedSearch = useDebounce(search);

  const { data: prestataires } = useQuery({
    queryKey: ['prestataires-select'],
    queryFn: () => api.get('/prestataires', { params: { is_active: true, limit: 200 } }).then((r) => r.data.data),
  });
  const prestataireOptions = (prestataires ?? []).map((p: { id: string; nom: string }) => ({ value: p.id, label: p.nom }));

  const { data, isLoading, isError } = useQuery({
    queryKey: ['maintenances', { page, debouncedSearch, type, statut, prestataireId }],
    queryFn: () =>
      api.get('/maintenances', { params: { page, limit: 20, search: debouncedSearch || undefined, type: type || undefined, statut: statut || undefined, prestataire_id: prestataireId || undefined } }).then((r) => r.data),
  });

  const rows: Maintenance[] = data?.data ?? [];
  const meta: PaginationMeta | undefined = data?.meta;
  const colonnesOptionnelles = useColonnesOptionnelles<Maintenance>('maintenances');

  const columns: Column<Maintenance>[] = [
    { key: 'reference', header: 'Réf.', render: (x: { reference?: string | null }) => <span className="font-mono text-xs text-gray-500">{x.reference ?? '—'}</span> },
    { key: 'site', header: 'Site', render: (m) => <span className="font-medium text-gray-800">{m.site?.nom ?? '—'}</span> },
    {
      key: 'equipement',
      header: 'Équipement',
      render: (m) => (
        <div className="flex items-center gap-2">
          <span>{m.equipement}</span>
          {!!m._count?.photos && (
            <span
              title={`${m._count.photos} photo${m._count.photos > 1 ? 's' : ''}`}
              className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-600 ring-1 ring-inset ring-indigo-100"
            >
              <Camera size={11} strokeWidth={2.5} />
              {m._count.photos}
            </span>
          )}
        </div>
      ),
    },
    { key: 'type', header: 'Type', render: (m) => TYPES_MAINTENANCE.find((t) => t.value === m.type)?.label ?? m.type },
    { key: 'categorie', header: 'Catégorie', render: (m) => CATEGORIES_EQUIPEMENT.find((c) => c.value === m.categorie)?.label ?? m.categorie },
    { key: 'prestataire', header: 'Prestataire', render: (m) => m.prestataire?.nom ?? '—' },
    { key: 'statut', header: 'Statut', render: (m) => <StatutMaintBadge value={m.statut} /> },
    { key: 'technicien', header: 'Technicien', render: (m) => (m.technicien ? `${m.technicien.prenom} ${m.technicien.nom}` : '—') },
    { key: 'datePlanifiee', header: 'Planifiée', render: (m) => fmtDateTime(m.datePlanifiee) },
    ...colonnesOptionnelles,
  ];

  return (
    <div>
      <PageHeader
        title="Maintenances"
        actions={
          <>
            <ButtonLink href="/maintenance/planning" variant="secondary" icon={CalendarDays}>Planning</ButtonLink>
            {roleExport !== 'TECHNICIEN' && <ExportButtons base="/maintenances/export" name="maintenances"/>}
            <ButtonLink href="/maintenance/nouveau" icon={Plus}>Planifier</ButtonLink>
          </>
        }
      />

      <FilterBar
        search={search}
        onSearch={(v) => { setSearch(v); setPage(1); }}
        searchPlaceholder="Rechercher (site, équipement)…"
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
