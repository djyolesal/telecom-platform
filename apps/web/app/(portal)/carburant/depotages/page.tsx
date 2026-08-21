'use client';

import { useState, Suspense } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Download, Camera } from 'lucide-react';
import { api } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { ExportButtons } from '@/components/shared/ExportButtons';
import { PageHeader } from '@/components/shared/PageHeader';
import { FilterBar } from '@/components/shared/FilterBar';
import { DataTable, Column } from '@/components/shared/DataTable';
import { Pagination, PaginationMeta } from '@/components/shared/Pagination';
import { TableSkeleton, EmptyState, ErrorState } from '@/components/shared/states';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { fmtNumber, fmtDate } from '@/lib/utils';

import { useColonnesOptionnelles } from '@/lib/hooks/useColonnesOptionnelles';

interface Depotage {
  id: string;
  reference?: string | null;
  dateDepotage: string;
  volumeLitres: number;
  stockApresLitres?: number;
  ecartLivraisonLitres?: number | null;
  fournisseur?: string;
  photoCount?: number;
  numeroBonLivraison?: string | null;
  stockAvantLitres?: number | null;
  coutTotal?: number | null;
  technicien?: { nom: string; prenom: string } | null;
  site?: { code: string; nom: string; region: string };
}

function DepotagesPageInner() {
  // L'export est refusé au TECHNICIEN (rbac serveur) : bouton masqué.
  const { data: sessionExp } = useSession();
  const roleExport = (sessionExp?.user as { role?: string })?.role ?? '';
  const router = useRouter();
  const searchParams = useSearchParams();
  const siteId = searchParams.get('site_id') || undefined;
  const [page, setPage] = useState(1);
  const [fournisseur, setFournisseur] = useState('');
  const debounced = useDebounce(fournisseur);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['depotages', { page, debounced, siteId }],
    queryFn: () => api.get('/depotages', { params: { page, limit: 20, fournisseur: debounced || undefined, site_id: siteId } }).then((r) => r.data),
  });

  const rows: Depotage[] = data?.data ?? [];
  const meta: PaginationMeta | undefined = data?.meta;
  const colonnesOptionnelles = useColonnesOptionnelles<Depotage>('depotages');

  const columns: Column<Depotage>[] = [
    { key: 'reference', header: 'Réf.', render: (x: { reference?: string | null }) => <span className="font-mono text-xs text-gray-500">{x.reference ?? '—'}</span> },
    { key: 'site', header: 'Site', render: (d) => <span className="font-medium text-gray-800">{d.site?.nom ?? "—"}</span> },
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
    {
      key: 'photoCount',
      header: 'Photos',
      align: 'center',
      render: (d) =>
        d.photoCount && d.photoCount > 0 ? (
          <span className="inline-flex items-center gap-1 text-gray-600"><Camera size={14} /> {d.photoCount}</span>
        ) : (
          <span className="text-gray-300">—</span>
        ),
    },
    ...colonnesOptionnelles,
  ];

  return (
    <div>
      <PageHeader
        title="Dépotages carburant"
        subtitle="Historique des livraisons de gasoil"
        backHref="/carburant/stock"
        actions={roleExport !== 'TECHNICIEN'
          ? <ExportButtons base="/depotages/export" name="depotages" />
          : undefined}
      />

      <FilterBar search={fournisseur} onSearch={(v) => { setFournisseur(v); setPage(1); }} searchPlaceholder="Rechercher un fournisseur…" />

      {siteId && (
        <div className="mb-3 flex items-center gap-2 text-sm text-blue-700">
          <span>Filtré sur le site sélectionné{rows[0]?.site ? ` (${rows[0].site.nom})` : ''}.</span>
          <button onClick={() => router.push('/carburant/depotages')} className="underline hover:no-underline">Voir tous les dépotages</button>
        </div>
      )}

      {isLoading ? (
        <TableSkeleton cols={7} />
      ) : isError ? (
        <ErrorState />
      ) : rows.length === 0 ? (
        <EmptyState title="Aucun dépotage" />
      ) : (
        <>
          <DataTable columns={columns} data={rows} maxHeight="65vh" onRowClick={(d) => router.push(`/carburant/${d.id}`)} />
          <Pagination meta={meta} onChange={setPage} />
        </>
      )}
    </div>
  );
}

export default function DepotagesPage() {
  return (
    <Suspense fallback={<TableSkeleton cols={7} />}>
      <DepotagesPageInner />
    </Suspense>
  );
}
