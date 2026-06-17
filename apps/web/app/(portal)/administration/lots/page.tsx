'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { FilterBar } from '@/components/shared/FilterBar';
import { DataTable, Column } from '@/components/shared/DataTable';
import { Pagination, PaginationMeta } from '@/components/shared/Pagination';
import { TableSkeleton, EmptyState, ErrorState } from '@/components/shared/states';
import { Badge } from '@/components/shared/Badge';
import { Button } from '@/components/shared/Button';
import { Field, Input, Select } from '@/components/shared/Form';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { regionOptions, SCOPES_MAINTENANCE, SCOPE_COLORS } from '@/lib/constants';

interface Assignment { id: string; scope: string; prestataire: { id: string; nom: string } }
interface Lot {
  id: string;
  code: string;
  nom: string;
  region?: string;
  assignments: Assignment[];
  _count?: { sites: number };
}

const scopeLabel = (s: string) => SCOPES_MAINTENANCE.find((o) => o.value === s)?.label ?? s;

function CreateModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ code: '', nom: '', region: '' });
  const [error, setError] = useState('');
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: () => api.post('/lots', { code: form.code, nom: form.nom, region: form.region || undefined }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['lots'] }); onClose(); },
    onError: (e: { response?: { data?: { error?: string } } }) => setError(e.response?.data?.error || 'Erreur'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-800">Nouveau lot</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={18} /></button>
        </div>
        {error && <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>}
        <form onSubmit={(e) => { e.preventDefault(); setError(''); mutation.mutate(); }} className="space-y-3">
          <Field label="Code" required><Input value={form.code} onChange={(e) => set('code', e.target.value)} required placeholder="LOT-MAR-01" /></Field>
          <Field label="Nom" required><Input value={form.nom} onChange={(e) => set('nom', e.target.value)} required placeholder="Lot Maritime Sud" /></Field>
          <Field label="Région"><Select value={form.region} onChange={(e) => set('region', e.target.value)} options={regionOptions} placeholder="—" /></Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>Annuler</Button>
            <Button type="submit" loading={mutation.isPending}>Créer</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function LotsPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [region, setRegion] = useState('');
  const [showModal, setShowModal] = useState(false);
  const debounced = useDebounce(search);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['lots', { page, debounced, region }],
    queryFn: () => api.get('/lots', { params: { page, limit: 20, search: debounced || undefined, region: region || undefined } }).then((r) => r.data),
  });

  const rows: Lot[] = data?.data ?? [];
  const meta: PaginationMeta | undefined = data?.meta;

  const columns: Column<Lot>[] = [
    { key: 'code', header: 'Code', render: (l) => <span className="font-medium text-gray-800">{l.code}</span> },
    { key: 'nom', header: 'Nom' },
    { key: 'region', header: 'Région', render: (l) => l.region || '—' },
    { key: 'sites', header: 'Sites', align: 'center', render: (l) => l._count?.sites ?? 0 },
    {
      key: 'assignments', header: 'Attributions', render: (l) => (
        <div className="flex flex-wrap gap-1">
          {l.assignments.length === 0 && <span className="text-gray-400 text-xs">—</span>}
          {l.assignments.map((a) => (
            <Badge key={a.id} className={SCOPE_COLORS[a.scope] || 'bg-gray-100 text-gray-600'}>
              {a.prestataire.nom} · {scopeLabel(a.scope)}
            </Badge>
          ))}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Lots de maintenance"
        subtitle="Lots de sites et attributions aux prestataires"
        backHref="/administration"
        actions={<Button icon={Plus} onClick={() => setShowModal(true)}>Nouveau lot</Button>}
      />

      <FilterBar
        search={search}
        onSearch={(v) => { setSearch(v); setPage(1); }}
        searchPlaceholder="Rechercher (code, nom)…"
        filters={[{ key: 'region', label: 'Toutes régions', value: region, options: regionOptions, onChange: (v) => { setRegion(v); setPage(1); } }]}
      />

      {isLoading ? (
        <TableSkeleton cols={5} />
      ) : isError ? (
        <ErrorState />
      ) : rows.length === 0 ? (
        <EmptyState title="Aucun lot" hint="Créez un lot puis attribuez-lui des sites et des prestataires." />
      ) : (
        <>
          <DataTable columns={columns} data={rows} onRowClick={(l) => router.push(`/administration/lots/${l.id}`)} />
          <Pagination meta={meta} onChange={setPage} />
        </>
      )}

      {showModal && <CreateModal onClose={() => setShowModal(false)} />}
    </div>
  );
}
