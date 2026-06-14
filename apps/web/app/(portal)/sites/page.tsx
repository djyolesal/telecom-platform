'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Plus, Download, MapPin } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { FilterBar } from '@/components/shared/FilterBar';
import { DataTable, Column } from '@/components/shared/DataTable';
import { Pagination, PaginationMeta } from '@/components/shared/Pagination';
import { TableSkeleton, EmptyState, ErrorState } from '@/components/shared/states';
import { ButtonLink } from '@/components/shared/Button';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { regionOptions, STATUTS_GE, POWER_CONFIGS } from '@/lib/constants';

interface Site {
  id: string;
  code: string;
  nom: string;
  region: string;
  ville?: string;
  powerConfig: string;
  statutGE: string;
  puissanceGEkva: number;
}

export default function SitesPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [region, setRegion] = useState('');
  const [statutGe, setStatutGe] = useState('');
  const [powerConfig, setPowerConfig] = useState('');
  const debouncedSearch = useDebounce(search);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['sites', { page, debouncedSearch, region, statutGe, powerConfig }],
    queryFn: () =>
      api
        .get('/sites', {
          params: { page, limit: 20, search: debouncedSearch || undefined, region: region || undefined, statut_ge: statutGe || undefined, power_config: powerConfig || undefined },
        })
        .then((r) => r.data),
  });

  const sites: Site[] = data?.data ?? [];
  const meta: PaginationMeta | undefined = data?.meta;

  const columns: Column<Site>[] = [
    { key: 'code', header: 'Code', render: (s) => <span className="font-medium text-gray-800">{s.code}</span> },
    { key: 'nom', header: 'Nom' },
    { key: 'region', header: 'Région' },
    { key: 'ville', header: 'Ville', render: (s) => s.ville || '—' },
    { key: 'powerConfig', header: 'Config énergie', render: (s) => POWER_CONFIGS.find((p) => p.value === s.powerConfig)?.label ?? s.powerConfig },
    { key: 'statutGE', header: 'Statut GE', render: (s) => STATUTS_GE.find((p) => p.value === s.statutGE)?.label ?? s.statutGE },
    { key: 'puissanceGEkva', header: 'kVA', align: 'right', render: (s) => Number(s.puissanceGEkva).toFixed(0) },
  ];

  return (
    <div>
      <PageHeader
        title="Sites"
        subtitle="Parc de sites BTS / antennes"
        actions={
          <>
            <a
              href={`${process.env.NEXT_PUBLIC_API_URL}/sites/export/xlsx`}
              className="inline-flex items-center gap-2 rounded-lg bg-white border border-gray-200 px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <Download size={15} /> Export
            </a>
            <ButtonLink href="/sites/nouveau" icon={Plus}>Nouveau site</ButtonLink>
          </>
        }
      />

      <FilterBar
        search={search}
        onSearch={(v) => { setSearch(v); setPage(1); }}
        searchPlaceholder="Rechercher par nom ou code…"
        filters={[
          { key: 'region', label: 'Toutes régions', value: region, options: regionOptions, onChange: (v) => { setRegion(v); setPage(1); } },
          { key: 'statut', label: 'Statut GE', value: statutGe, options: STATUTS_GE, onChange: (v) => { setStatutGe(v); setPage(1); } },
          { key: 'power', label: 'Config énergie', value: powerConfig, options: POWER_CONFIGS, onChange: (v) => { setPowerConfig(v); setPage(1); } },
        ]}
      />

      {isLoading ? (
        <TableSkeleton cols={7} />
      ) : isError ? (
        <ErrorState />
      ) : sites.length === 0 ? (
        <EmptyState title="Aucun site" hint="Ajustez les filtres ou créez un nouveau site." />
      ) : (
        <>
          <DataTable columns={columns} data={sites} onRowClick={(s) => router.push(`/sites/${s.id}`)} />
          <Pagination meta={meta} onChange={setPage} />
        </>
      )}

      {!isLoading && sites.length === 0 && (
        <div className="mt-4 flex items-center gap-2 text-xs text-gray-400">
          <MapPin size={14} /> Astuce : la carte temps réel est disponible dans Supervision.
        </div>
      )}
    </div>
  );
}
