'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/shared/Button';
import { Input, Select } from '@/components/shared/Form';
import { Loading, ErrorState, EmptyState } from '@/components/shared/states';
import { CATEGORIES_EQUIPEMENT } from '@/lib/constants';

interface Equipement { code: string; libelle: string; categorie: string; actif: boolean }

const catLabel = (c: string) => CATEGORIES_EQUIPEMENT.find((o) => o.value === c)?.label ?? c;
const CAT_BADGE: Record<string, string> = {
  SOLAIRE: 'bg-yellow-100 text-yellow-800',
  ANTENNE: 'bg-orange-100 text-orange-700',
  RESEAU: 'bg-orange-100 text-orange-700',
};

/**
 * Référentiel des équipements de dépannage (ATS, TGBT, GE, compteur CEET…) :
 * chaque entrée porte sa catégorie contractuelle parente — c'est elle qui
 * route l'intervention (prestataire passif/actif/solaire, équipe, clôture).
 * Servi au mobile via /config : évolutions sans mise à jour d'application.
 */
export default function EquipementsPage() {
  const queryClient = useQueryClient();
  const [nouveau, setNouveau] = useState({ code: '', libelle: '', categorie: 'AUTRE' });
  const [editCode, setEditCode] = useState<string | null>(null);
  const [edit, setEdit] = useState({ libelle: '', categorie: 'AUTRE' });
  const [error, setError] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['equipements-ref'],
    queryFn: () => api.get('/equipements').then((r) => r.data.data as Equipement[]),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['equipements-ref'] });
    queryClient.invalidateQueries({ queryKey: ['app-config'] });
  };
  const onErr = (e: { response?: { data?: { error?: string } } }) => setError(e.response?.data?.error || 'Erreur');

  const save = useMutation({
    mutationFn: (t: { code: string; libelle: string; categorie: string; actif?: boolean }) => api.post('/admin/equipements', t),
    onSuccess: () => { refresh(); setNouveau({ code: '', libelle: '', categorie: 'AUTRE' }); setEditCode(null); setError(''); },
    onError: onErr,
  });
  const remove = useMutation({
    mutationFn: (code: string) => api.delete(`/admin/equipements/${code}`),
    onSuccess: () => { refresh(); setError(''); },
    onError: onErr,
  });

  if (isLoading) return <Loading />;
  if (isError) return <ErrorState />;
  const rows = data ?? [];

  return (
    <div>
      <PageHeader
        title="Équipements de dépannage"
        subtitle="La catégorie parente route l'intervention vers le bon contrat (passif, actif ou solaire)"
        backHref="/administration"
      />

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}

      <div className="mb-4 rounded-xl border border-gray-100 bg-white p-4">
        <p className="mb-3 text-sm font-semibold text-gray-700">Ajouter un équipement</p>
        <form
          onSubmit={(e) => { e.preventDefault(); save.mutate(nouveau); }}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <Input value={nouveau.code} onChange={(e) => setNouveau((f) => ({ ...f, code: e.target.value }))} placeholder="Code (ex. ONDULEUR)" className="sm:w-52" required />
          <Input value={nouveau.libelle} onChange={(e) => setNouveau((f) => ({ ...f, libelle: e.target.value }))} placeholder="Libellé affiché" className="flex-1" required />
          <Select value={nouveau.categorie} onChange={(e) => setNouveau((f) => ({ ...f, categorie: e.target.value }))} options={CATEGORIES_EQUIPEMENT} className="sm:w-56" />
          <Button type="submit" icon={Plus} loading={save.isPending}>Ajouter</Button>
        </form>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="Aucun équipement" />
      ) : (
        <div className="divide-y divide-gray-50 rounded-xl border border-gray-100 bg-white">
          {rows.map((t) => (
            <div key={t.code} className={`flex items-center gap-3 p-3.5 ${t.actif ? '' : 'opacity-50'}`}>
              <code className="w-48 shrink-0 text-xs text-gray-500">{t.code}</code>
              {editCode === t.code ? (
                <>
                  <Input value={edit.libelle} onChange={(e) => setEdit((f) => ({ ...f, libelle: e.target.value }))} className="flex-1" autoFocus />
                  <Select value={edit.categorie} onChange={(e) => setEdit((f) => ({ ...f, categorie: e.target.value }))} options={CATEGORIES_EQUIPEMENT} className="w-52" />
                  <button type="button" className="rounded p-1.5 text-green-600 hover:bg-green-50" onClick={() => save.mutate({ code: t.code, ...edit })} title="Enregistrer"><Check size={16} /></button>
                  <button type="button" className="rounded p-1.5 text-gray-400 hover:bg-gray-50" onClick={() => setEditCode(null)} title="Annuler"><X size={16} /></button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm font-medium text-gray-800">
                    {t.libelle}
                    {!t.actif && <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">désactivé</span>}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${CAT_BADGE[t.categorie] ?? 'bg-blue-50 text-blue-700'}`}>{catLabel(t.categorie)}</span>
                  <button
                    type="button"
                    className="rounded px-2 py-1 text-xs font-medium text-[#2471A3] hover:bg-[#EAF1F8]"
                    onClick={() => save.mutate({ code: t.code, libelle: t.libelle, categorie: t.categorie, actif: !t.actif })}
                  >
                    {t.actif ? 'Désactiver' : 'Réactiver'}
                  </button>
                  <button type="button" className="rounded p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600" onClick={() => { setEditCode(t.code); setEdit({ libelle: t.libelle, categorie: t.categorie }); }} title="Modifier"><Pencil size={15} /></button>
                  <button
                    type="button"
                    className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                    onClick={() => { if (confirm(`Supprimer « ${t.libelle} » ? Refusé s'il est utilisé (désactivez-le alors).`)) remove.mutate(t.code); }}
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
