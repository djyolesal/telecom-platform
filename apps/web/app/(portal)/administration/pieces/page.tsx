'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Check, X, Pencil, Link2 } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/shared/Button';
import { Input } from '@/components/shared/Form';
import { Loading, ErrorState } from '@/components/shared/states';
import { fmtNumber } from '@/lib/utils';

interface PieceRef {
  id: string; code: string; libelle: string; categorie: string | null;
  unite: string; coutStandard: string | number | null; actif: boolean;
  utilisations: number;
}

/**
 * Catalogue des pièces de rechange (traçabilité niveau 1) : la saisie terrain
 * reste LIBRE - le serveur rapproche automatiquement le texte saisi vers ce
 * catalogue (casse/accents/espaces ignorés), ce qui rend la consommation
 * agrégeable par pièce × site × prestataire. Enrichir le catalogue relie
 * aussi l'historique déjà saisi ; supprimer une entrée ne touche jamais les
 * consommations passées (elles gardent leur texte).
 */
export default function PiecesRefPage() {
  const queryClient = useQueryClient();
  const [nouveau, setNouveau] = useState({ libelle: '', code: '', unite: '', coutStandard: '' });
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState({ libelle: '', unite: '', coutStandard: '' });
  const [error, setError] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['pieces-ref-admin'],
    queryFn: () => api.get('/pieces-ref').then((r) => r.data.data as PieceRef[]),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['pieces-ref-admin'] });
    queryClient.invalidateQueries({ queryKey: ['pieces-ref'] });
  };
  const onErr = (e: { response?: { data?: { error?: string } } }) => setError(e.response?.data?.error || 'Erreur');

  const save = useMutation({
    mutationFn: (p: { id?: string; code?: string; libelle: string; unite?: string; coutStandard?: number; actif?: boolean }) =>
      api.post('/admin/pieces-ref', p),
    onSuccess: () => { refresh(); setNouveau({ libelle: '', code: '', unite: '', coutStandard: '' }); setEditId(null); setError(''); },
    onError: onErr,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/pieces-ref/${id}`),
    onSuccess: () => { refresh(); setError(''); },
    onError: onErr,
  });
  const rapprocher = useMutation({
    mutationFn: () => api.post('/admin/pieces-ref/rapprocher'),
    onSuccess: (r) => {
      const b = r.data.data as { examinees: number; rapprochees: number };
      toast(`${b.rapprochees} ligne(s) de l'historique rattachée(s) (${b.examinees} examinée(s)).`, 'success');
      refresh();
    },
    onError: (e: { response?: { data?: { error?: string } } }) => toast(e.response?.data?.error || 'Rapprochement impossible', 'error'),
  });

  if (isLoading) return <Loading />;
  if (isError) return <ErrorState />;
  const pieces = data ?? [];

  return (
    <div>
      <PageHeader
        title="Pièces de rechange"
        subtitle="Catalogue de rapprochement : la saisie terrain reste libre, le serveur fait le lien"
        backHref="/administration"
        actions={
          <Button variant="secondary" icon={Link2} loading={rapprocher.isPending} onClick={() => rapprocher.mutate()}>
            Rapprocher l&apos;historique
          </Button>
        }
      />

      <div className="mb-4 rounded-xl border border-gray-100 bg-white p-4">
        <p className="mb-3 text-xs text-gray-500">
          Nouvelle pièce - le code se déduit du libellé si absent. Les saisies terrain dont le texte
          correspond (casse, accents et espaces ignorés) se rattachent automatiquement, y compris l&apos;historique.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-72"><Input placeholder="Libellé (ex. Batterie 12 V 100 Ah)" value={nouveau.libelle} onChange={(e) => setNouveau({ ...nouveau, libelle: e.target.value })} /></div>
          <div className="w-40"><Input placeholder="Code (optionnel)" value={nouveau.code} onChange={(e) => setNouveau({ ...nouveau, code: e.target.value })} /></div>
          <div className="w-28"><Input placeholder="Unité" value={nouveau.unite} onChange={(e) => setNouveau({ ...nouveau, unite: e.target.value })} /></div>
          <div className="w-40"><Input placeholder="Coût standard FCFA" type="number" value={nouveau.coutStandard} onChange={(e) => setNouveau({ ...nouveau, coutStandard: e.target.value })} /></div>
          <Button icon={Plus} disabled={!nouveau.libelle.trim()} loading={save.isPending}
            onClick={() => save.mutate({ libelle: nouveau.libelle, code: nouveau.code || undefined, unite: nouveau.unite || undefined, coutStandard: nouveau.coutStandard ? Number(nouveau.coutStandard) : undefined })}>
            Ajouter
          </Button>
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-gray-100 text-left text-xs text-gray-500">
            <th className="py-3 pl-5 pr-3 font-medium">Code</th>
            <th className="px-3 py-3 font-medium">Libellé</th>
            <th className="px-3 py-3 font-medium">Unité</th>
            <th className="px-3 py-3 text-right font-medium">Coût standard</th>
            <th className="px-3 py-3 text-right font-medium">Consommations liées</th>
            <th className="px-3 py-3 text-center font-medium">Actif</th>
            <th className="px-3 py-3 pr-5 text-right font-medium">Actions</th>
          </tr></thead>
          <tbody>
            {pieces.length === 0 && (
              <tr><td colSpan={7} className="px-5 py-8 text-center text-sm text-gray-400">
                Catalogue vide - ajoutez les pièces les plus consommées, l&apos;historique déjà saisi se rattachera tout seul.
              </td></tr>
            )}
            {pieces.map((p) => (
              <tr key={p.id} className="border-b border-gray-50 last:border-0">
                <td className="py-2.5 pl-5 pr-3 font-mono text-xs text-gray-500">{p.code}</td>
                <td className="px-3 py-2.5">
                  {editId === p.id
                    ? <Input value={edit.libelle} onChange={(e) => setEdit({ ...edit, libelle: e.target.value })} />
                    : <span className="font-medium text-gray-800">{p.libelle}</span>}
                </td>
                <td className="px-3 py-2.5 text-gray-600">
                  {editId === p.id
                    ? <div className="w-24"><Input value={edit.unite} onChange={(e) => setEdit({ ...edit, unite: e.target.value })} /></div>
                    : p.unite}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">
                  {editId === p.id
                    ? <div className="ml-auto w-32"><Input type="number" value={edit.coutStandard} onChange={(e) => setEdit({ ...edit, coutStandard: e.target.value })} /></div>
                    : p.coutStandard != null ? `${fmtNumber(Number(p.coutStandard))} F` : '—'}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{p.utilisations > 0 ? p.utilisations : <span className="text-gray-300">0</span>}</td>
                <td className="px-3 py-2.5 text-center">
                  <button type="button" title={p.actif ? 'Désactiver (plus proposée, historique conservé)' : 'Réactiver'}
                    onClick={() => save.mutate({ id: p.id, libelle: p.libelle, actif: !p.actif })}
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${p.actif ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {p.actif ? 'Actif' : 'Inactif'}
                  </button>
                </td>
                <td className="px-3 py-2.5 pr-5 text-right">
                  {editId === p.id ? (
                    <span className="inline-flex gap-1">
                      <button type="button" className="text-green-600 hover:text-green-800"
                        onClick={() => save.mutate({ id: p.id, libelle: edit.libelle, unite: edit.unite || undefined, coutStandard: edit.coutStandard ? Number(edit.coutStandard) : undefined })}>
                        <Check size={16} />
                      </button>
                      <button type="button" className="text-gray-400 hover:text-gray-600" onClick={() => setEditId(null)}><X size={16} /></button>
                    </span>
                  ) : (
                    <span className="inline-flex gap-2">
                      <button type="button" className="text-gray-400 hover:text-gray-700"
                        onClick={() => { setEditId(p.id); setEdit({ libelle: p.libelle, unite: p.unite, coutStandard: p.coutStandard != null ? String(p.coutStandard) : '' }); }}>
                        <Pencil size={15} />
                      </button>
                      <button type="button" className="text-red-400 hover:text-red-600"
                        onClick={() => { if (confirm(`Supprimer « ${p.libelle} » du catalogue ? Les consommations passées gardent leur texte.`)) remove.mutate(p.id); }}>
                        <Trash2 size={15} />
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
