'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Power, X } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { FilterBar } from '@/components/shared/FilterBar';
import { DataTable, Column } from '@/components/shared/DataTable';
import { Pagination, PaginationMeta } from '@/components/shared/Pagination';
import { TableSkeleton, EmptyState, ErrorState } from '@/components/shared/states';
import { Badge } from '@/components/shared/Badge';
import { Button } from '@/components/shared/Button';
import { Field, Input } from '@/components/shared/Form';
import { useDebounce } from '@/lib/hooks/useDebounce';

interface Prestataire {
  id: string;
  nom: string;
  contactNom?: string;
  telephone?: string;
  email?: string;
  isActive: boolean;
  _count?: { assignments: number };
}

function CreateModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ nom: '', contactNom: '', telephone: '', email: '' });
  const [error, setError] = useState('');
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: () => api.post('/prestataires', { ...form, contactNom: form.contactNom || undefined, telephone: form.telephone || undefined, email: form.email || undefined }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['prestataires'] }); onClose(); },
    onError: (e: { response?: { data?: { error?: string } } }) => setError(e.response?.data?.error || 'Erreur'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-800">Nouveau prestataire</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={18} /></button>
        </div>
        {error && <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>}
        <form onSubmit={(e) => { e.preventDefault(); setError(''); mutation.mutate(); }} className="grid grid-cols-2 gap-3">
          <Field label="Nom" required className="col-span-2"><Input value={form.nom} onChange={(e) => set('nom', e.target.value)} required /></Field>
          <Field label="Contact"><Input value={form.contactNom} onChange={(e) => set('contactNom', e.target.value)} /></Field>
          <Field label="Téléphone"><Input value={form.telephone} onChange={(e) => set('telephone', e.target.value)} /></Field>
          <Field label="Email" className="col-span-2"><Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></Field>
          <div className="col-span-2 flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>Annuler</Button>
            <Button type="submit" loading={mutation.isPending}>Créer</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function PrestatairesPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const debounced = useDebounce(search);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['prestataires', { page, debounced }],
    queryFn: () => api.get('/prestataires', { params: { page, limit: 20, search: debounced || undefined } }).then((r) => r.data),
  });

  const toggle = useMutation({
    mutationFn: (id: string) => api.post(`/prestataires/${id}/toggle-active`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['prestataires'] }),
  });

  const rows: Prestataire[] = data?.data ?? [];
  const meta: PaginationMeta | undefined = data?.meta;

  const columns: Column<Prestataire>[] = [
    { key: 'nom', header: 'Nom', render: (p) => <span className="font-medium text-gray-800">{p.nom}</span> },
    { key: 'contactNom', header: 'Contact', render: (p) => p.contactNom || '—' },
    { key: 'telephone', header: 'Téléphone', render: (p) => p.telephone || '—' },
    { key: 'email', header: 'Email', render: (p) => p.email || '—' },
    { key: 'lots', header: 'Lots attribués', align: 'center', render: (p) => p._count?.assignments ?? 0 },
    { key: 'isActive', header: 'Statut', render: (p) => <Badge className={p.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}>{p.isActive ? 'Actif' : 'Inactif'}</Badge> },
    {
      key: 'actions', header: '', align: 'right', render: (p) => (
        <button onClick={() => toggle.mutate(p.id)} title={p.isActive ? 'Désactiver' : 'Activer'} className="p-1.5 rounded hover:bg-gray-100">
          <Power size={15} className={p.isActive ? 'text-green-600' : 'text-gray-400'} />
        </button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Prestataires"
        subtitle="Sociétés de maintenance externes"
        backHref="/administration"
        actions={<Button icon={Plus} onClick={() => setShowModal(true)}>Nouveau prestataire</Button>}
      />

      <FilterBar search={search} onSearch={(v) => { setSearch(v); setPage(1); }} searchPlaceholder="Rechercher (nom, email)…" />

      {isLoading ? (
        <TableSkeleton cols={7} />
      ) : isError ? (
        <ErrorState />
      ) : rows.length === 0 ? (
        <EmptyState title="Aucun prestataire" />
      ) : (
        <>
          <DataTable columns={columns} data={rows} />
          <Pagination meta={meta} onChange={setPage} />
        </>
      )}

      {showModal && <CreateModal onClose={() => setShowModal(false)} />}
    </div>
  );
}
