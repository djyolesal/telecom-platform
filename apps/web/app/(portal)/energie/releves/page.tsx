'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { api } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { PageHeader } from '@/components/shared/PageHeader';
import { FilterBar } from '@/components/shared/FilterBar';
import { DataTable, Column } from '@/components/shared/DataTable';
import { Pagination, PaginationMeta } from '@/components/shared/Pagination';
import { TableSkeleton, EmptyState, ErrorState } from '@/components/shared/states';
import { Badge } from '@/components/shared/Badge';
import { SOURCES_ENERGIE } from '@/lib/constants';
import { fmtNumber, fmtDate } from '@/lib/utils';

interface Releve {
  id: string;
  dateReleve: string;
  source: string;
  consommationKwh?: number;
  volumeGasoilLitres?: number;
  heuresFonctGE?: number;
  site?: { code: string; nom: string };
}

const SOURCE_COLOR: Record<string, string> = {
  CEET: 'bg-blue-100 text-blue-700',
  GE: 'bg-orange-100 text-orange-700',
  SOLAIRE: 'bg-green-100 text-green-700',
};

export default function RelevesPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [source, setSource] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['releves', { page, source }],
    queryFn: () => api.get('/releves', { params: { page, limit: 20, source: source || undefined } }).then((r) => r.data),
  });

  const rows: Releve[] = data?.data ?? [];
  const meta: PaginationMeta | undefined = data?.meta;

  const columns: Column<Releve>[] = [
    { key: 'site', header: 'Site', render: (r) => <span className="font-medium text-gray-800">{r.site?.nom ?? r.site?.code ?? "—"}</span> },
    { key: 'dateReleve', header: 'Date', render: (r) => fmtDate(r.dateReleve) },
    { key: 'source', header: 'Source', render: (r) => <Badge className={SOURCE_COLOR[r.source] || 'bg-gray-100 text-gray-600'}>{r.source}</Badge> },
    { key: 'consommationKwh', header: 'Conso (kWh)', align: 'right', render: (r) => (r.consommationKwh != null ? fmtNumber(Number(r.consommationKwh)) : '—') },
    { key: 'volumeGasoilLitres', header: 'Gasoil (L)', align: 'right', render: (r) => (r.volumeGasoilLitres != null ? fmtNumber(Number(r.volumeGasoilLitres)) : '—') },
    { key: 'heuresFonctGE', header: 'Heures GE', align: 'right', render: (r) => (r.heuresFonctGE != null ? Number(r.heuresFonctGE) : '—') },
  ];

  return (
    <div>
      <PageHeader
        title="Relevés énergie"
        backHref="/energie"
        actions={
          <button type="button" onClick={() => downloadFile('/releves/export/xlsx', 'releves.xlsx')} className="inline-flex items-center gap-2 rounded-lg bg-white border border-gray-200 px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            <Download size={15} /> Export
          </button>
        }
      />

      <FilterBar
        filters={[{ key: 'source', label: 'Toutes sources', value: source, options: SOURCES_ENERGIE, onChange: (v) => { setSource(v); setPage(1); } }]}
      />

      {isLoading ? (
        <TableSkeleton cols={6} />
      ) : isError ? (
        <ErrorState />
      ) : rows.length === 0 ? (
        <EmptyState title="Aucun relevé" />
      ) : (
        <>
          <DataTable columns={columns} data={rows} onRowClick={(r) => router.push(`/energie/releves/${r.id}`)} />
          <Pagination meta={meta} onChange={setPage} />
        </>
      )}
    </div>
  );
}
