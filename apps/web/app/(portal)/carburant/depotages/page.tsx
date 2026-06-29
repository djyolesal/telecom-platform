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
import { useDebounce } from '@/lib/hooks/useDebounce';
import { fmtNumber, fmtDate } from '@/lib/utils';

interface Depotage {
  id: string;
  dateDepotage: string;
  volumeLitres: number;
  stockApresLitres?: number;
  ecartLivraisonLitres?: number | null;
  fournisseur?: string;
  site?: { code: string; nom: string; region: string };
}

export default function DepotagesPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [fournisseur, setFournisseur] = useState('');
  const debounced = useDebounce(fournisseur);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['depotages', { page, debounced }],
    queryFn: () => api.get('/depotages', { params: { page, limit: 20, fournisseur: debounced || undefined } }).then((r) => r.data),
  });

  const rows: Depotage[] = data?.data ?? [];
  const meta: PaginationMeta | undefined = data?.meta;

  const columns: Column<Depotage>[] = [
    { key: 'site', header: 'Site', render: (d) => <span className="font-medium text-gray-800">{d.site?.nom ?? d.site?.code ?? "—"}</span> },
    { key: 'dateDepotage', header: 'Date', render: (d) => fmtDate(d.dateDepotage) },
    { key: 'volumeLitres', header: 'Volume (L)', align: 'right', render: (d) => fmtNumber(Number(d.volumeLitres)) },
    { key: 'stockApresLitres', header: 'Stock après (L)', align: 'right', render: (d) => (d.stockApresLitres != null ? fmtNumber(Number(d.stockApresLitres)) : '—') },
    {
      key: 'ecartLivraisonLitres',
      header: 'Écart livr. (L)',
      align: 'right',
      render: (d) => {
        if (d.ecartLivraisonLitres == null) return '—';
        const v = Number(d.ecartLivraisonLitres);
        const color = Math.abs(v) < 1 ? 'text-emerald-600' : v < 0 ? 'text-red-600' : 'text-amber-600';
        return <span className={color}>{`${v > 0 ? '+' : ''}${fmtNumber(v)}`}</span>;
      },
    },
    { key: 'fournisseur', header: 'Fournisseur', render: (d) => d.fournisseur || '—' },
  ];

  return (
    <div>
      <PageHeader
        title="Dépotages carburant"
        subtitle="Historique des livraisons de gasoil"
        backHref="/carburant/stock"
        actions={
          <button type="button" onClick={() => downloadFile('/depotages/export/xlsx', 'depotages.xlsx')} className="inline-flex items-center gap-2 rounded-lg bg-white border border-gray-200 px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            <Download size={15} /> Export
          </button>
        }
      />

      <FilterBar search={fournisseur} onSearch={(v) => { setFournisseur(v); setPage(1); }} searchPlaceholder="Rechercher un fournisseur…" />

      {isLoading ? (
        <TableSkeleton cols={6} />
      ) : isError ? (
        <ErrorState />
      ) : rows.length === 0 ? (
        <EmptyState title="Aucun dépotage" />
      ) : (
        <>
          <DataTable columns={columns} data={rows} onRowClick={(d) => router.push(`/carburant/${d.id}`)} />
          <Pagination meta={meta} onChange={setPage} />
        </>
      )}
    </div>
  );
}
