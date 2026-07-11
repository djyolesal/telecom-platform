'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/shared/Button';
import { Input } from '@/components/shared/Form';
import { Loading, ErrorState, EmptyState } from '@/components/shared/states';

interface TypePylone { code: string; libelle: string }

/**
 * Référentiel des types de pylône : liste éditable par l'admin (le code est
 * l'identifiant stable stocké sur les sites, le libellé est l'affichage).
 */
export default function TypesPylonePage() {
  const queryClient = useQueryClient();
  const [nouveau, setNouveau] = useState({ code: '', libelle: '' });
  const [editCode, setEditCode] = useState<string | null>(null);
  const [editLibelle, setEditLibelle] = useState('');
  const [error, setError] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['types-pylone'],
    queryFn: () => api.get('/types-pylone').then((r) => r.data.data as TypePylone[]),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['types-pylone'] });
  const onErr = (e: { response?: { data?: { error?: string } } }) => setError(e.response?.data?.error || 'Erreur');

  const save = useMutation({
    mutationFn: (t: { code: string; libelle: string }) => api.post('/admin/types-pylone', t),
    onSuccess: () => { refresh(); setNouveau({ code: '', libelle: '' }); setEditCode(null); setError(''); },
    onError: onErr,
  });
  const remove = useMutation({
    mutationFn: (code: string) => api.delete(`/admin/types-pylone/${code}`),
    onSuccess: () => { refresh(); setError(''); },
    onError: onErr,
  });

  if (isLoading) return <Loading />;
  if (isError) return <ErrorState />;
  const types = data ?? [];

  return (
    <div>
      <PageHeader
        title="Types de pylône"
        subtitle="Référentiel utilisé par les fiches sites et l'import Excel"
        backHref="/administration"
      />

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}

      <div className="mb-4 rounded-xl border border-gray-100 bg-white p-4">
        <p className="mb-3 text-sm font-semibold text-gray-700">Ajouter un type</p>
        <form
          onSubmit={(e) => { e.preventDefault(); save.mutate(nouveau); }}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <Input value={nouveau.code} onChange={(e) => setNouveau((f) => ({ ...f, code: e.target.value }))} placeholder="Code (ex. RU-GREENFIELD)" className="sm:w-64" required />
          <Input value={nouveau.libelle} onChange={(e) => setNouveau((f) => ({ ...f, libelle: e.target.value }))} placeholder="Libellé affiché (ex. RU-Greenfield)" className="flex-1" required />
          <Button type="submit" icon={Plus} loading={save.isPending}>Ajouter</Button>
        </form>
        <p className="mt-2 text-xs text-gray-400">Le code est normalisé en MAJUSCULES_SOULIGNÉES et sert d&apos;identifiant stable ; seul le libellé reste modifiable ensuite.</p>
      </div>

      {types.length === 0 ? (
        <EmptyState title="Aucun type" hint="Ajoutez un premier type de pylône." />
      ) : (
        <div className="divide-y divide-gray-50 rounded-xl border border-gray-100 bg-white">
          {types.map((t) => (
            <div key={t.code} className="flex items-center gap-3 p-3.5">
              <code className="w-56 shrink-0 text-xs text-gray-500">{t.code}</code>
              {editCode === t.code ? (
                <>
                  <Input value={editLibelle} onChange={(e) => setEditLibelle(e.target.value)} className="flex-1" autoFocus />
                  <button type="button" className="rounded p-1.5 text-green-600 hover:bg-green-50" onClick={() => save.mutate({ code: t.code, libelle: editLibelle })} title="Enregistrer"><Check size={16} /></button>
                  <button type="button" className="rounded p-1.5 text-gray-400 hover:bg-gray-50" onClick={() => setEditCode(null)} title="Annuler"><X size={16} /></button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm font-medium text-gray-800">{t.libelle}</span>
                  <button type="button" className="rounded p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600" onClick={() => { setEditCode(t.code); setEditLibelle(t.libelle); }} title="Renommer"><Pencil size={15} /></button>
                  <button
                    type="button"
                    className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                    onClick={() => { if (confirm(`Supprimer le type « ${t.libelle} » ? Refusé s'il est utilisé par des sites.`)) remove.mutate(t.code); }}
                    title="Supprimer"
                  >
                    <Trash2 size={15} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
