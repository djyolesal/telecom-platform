'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Check, X, Pencil } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/shared/Button';
import { Input } from '@/components/shared/Form';
import { Loading, ErrorState } from '@/components/shared/states';

interface Motif { id: string; champ: string; libelle: string; actif: boolean }

const CHAMPS = [
  { value: 'CAUSE', label: 'Causes', aide: 'Suggestions du champ « Cause » des coupures' },
  { value: 'ACTION', label: 'Actions effectuées', aide: 'Suggestions du champ « Actions effectuées »' },
];

/**
 * Formulations types des coupures : suggérées au NOC dans les champs Cause et
 * Actions pour unifier l'orthographe (« Coupure CEET/pas de GE » ne se décline
 * plus en variantes) — la frappe libre reste toujours possible, le texte est
 * stocké en clair sur la coupure. Supprimer un motif ne touche donc jamais
 * l'historique.
 */
export default function MotifsCoupurePage() {
  const queryClient = useQueryClient();
  const [champ, setChamp] = useState('CAUSE');
  const [nouveau, setNouveau] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editLibelle, setEditLibelle] = useState('');
  const [error, setError] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['motifs-coupure-admin'],
    queryFn: () => api.get('/motifs-coupure').then((r) => r.data.data as Motif[]),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['motifs-coupure-admin'] });
    queryClient.invalidateQueries({ queryKey: ['motifs-coupure'] });
  };
  const onErr = (e: { response?: { data?: { error?: string } } }) => setError(e.response?.data?.error || 'Erreur');

  const save = useMutation({
    mutationFn: (m: { id?: string; champ: string; libelle: string; actif?: boolean }) => api.post('/admin/motifs-coupure', m),
    onSuccess: () => { refresh(); setNouveau(''); setEditId(null); setError(''); },
    onError: onErr,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/motifs-coupure/${id}`),
    onSuccess: () => { refresh(); setError(''); },
    onError: onErr,
  });

  if (isLoading) return <Loading />;
  if (isError) return <ErrorState />;
  const motifs = (data ?? []).filter((m) => m.champ === champ);
  const champCourant = CHAMPS.find((c) => c.value === champ)!;

  return (
    <div>
      <PageHeader
        title="Motifs de coupure"
        subtitle="Formulations suggérées au NOC (cause, actions) - la frappe libre reste possible, l'historique n'est jamais touché"
        backHref="/administration"
      />

      <div className="mb-4 flex gap-2">
        {CHAMPS.map((c) => (
          <button key={c.value} type="button" onClick={() => { setChamp(c.value); setError(''); }}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium ${champ === c.value ? 'border-[#1B3F6B] bg-[#1B3F6B] text-white' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>
            {c.label}
          </button>
        ))}
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="mb-4 flex items-center gap-2">
        <div className="flex-1 max-w-xl">
          <Input value={nouveau} onChange={(e) => setNouveau(e.target.value)} placeholder={`Nouvelle formulation - ${champCourant.aide.toLowerCase()}`} maxLength={150}
            onKeyDown={(e) => { if (e.key === 'Enter' && nouveau.trim()) save.mutate({ champ, libelle: nouveau }); }} />
        </div>
        <Button icon={Plus} loading={save.isPending} disabled={!nouveau.trim()} onClick={() => save.mutate({ champ, libelle: nouveau })}>Ajouter</Button>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white">
        {motifs.length === 0 && (
          <p className="p-6 text-sm text-gray-400">Aucune formulation - ajoutez celles que le NOC utilise le plus (elles apparaîtront en suggestion à la saisie).</p>
        )}
        {motifs.map((m) => (
          <div key={m.id} className="flex items-center gap-2 border-b border-gray-50 px-4 py-2.5 last:border-0">
            {editId === m.id ? (
              <>
                <div className="flex-1"><Input value={editLibelle} onChange={(e) => setEditLibelle(e.target.value)} maxLength={150} autoFocus /></div>
                <button type="button" className="p-1 text-green-600" onClick={() => save.mutate({ id: m.id, champ: m.champ, libelle: editLibelle, actif: m.actif })}><Check size={16} /></button>
                <button type="button" className="p-1 text-gray-400" onClick={() => setEditId(null)}><X size={16} /></button>
              </>
            ) : (
              <>
                <span className={`flex-1 text-sm ${m.actif ? 'text-gray-800' : 'text-gray-400 line-through'}`}>{m.libelle}</span>
                <button type="button" title="Renommer" className="p-1 text-gray-400 hover:text-[#1B3F6B]" onClick={() => { setEditId(m.id); setEditLibelle(m.libelle); }}><Pencil size={15} /></button>
                <button type="button" title={m.actif ? 'Désactiver (ne sera plus suggérée)' : 'Réactiver'}
                  className={`rounded px-2 py-0.5 text-xs font-medium ${m.actif ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                  onClick={() => save.mutate({ id: m.id, champ: m.champ, libelle: m.libelle, actif: !m.actif })}>
                  {m.actif ? 'Active' : 'Inactive'}
                </button>
                <button type="button" title="Supprimer (l'historique des coupures n'est pas touché)" className="p-1 text-gray-400 hover:text-red-600"
                  onClick={() => remove.mutate(m.id)}><Trash2 size={15} /></button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
