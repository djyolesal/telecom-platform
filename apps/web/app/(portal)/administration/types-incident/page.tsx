'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Check, X, Lock } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/shared/Button';
import { Input } from '@/components/shared/Form';
import { Loading, ErrorState, EmptyState } from '@/components/shared/states';

interface TypeIncident { code: string; libelle: string; actif: boolean; systeme: boolean }

/**
 * Référentiel des types d'incident (ex-enum, éditable) : le code est
 * l'identifiant stable stocké sur les incidents, le libellé est l'affichage.
 * Les types « système » sont créés par la plateforme elle-même (coupures) :
 * renommables, jamais supprimables ni désactivables. Un type utilisé par
 * l'historique se DÉSACTIVE (il disparaît des formulaires, reste lisible).
 */
export default function TypesIncidentPage() {
  const queryClient = useQueryClient();
  const [nouveau, setNouveau] = useState({ code: '', libelle: '' });
  const [editCode, setEditCode] = useState<string | null>(null);
  const [editLibelle, setEditLibelle] = useState('');
  const [error, setError] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['types-incident'],
    queryFn: () => api.get('/types-incident').then((r) => r.data.data as TypeIncident[]),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['types-incident'] });
    queryClient.invalidateQueries({ queryKey: ['app-config'] });
  };
  const onErr = (e: { response?: { data?: { error?: string } } }) => setError(e.response?.data?.error || 'Erreur');

  const save = useMutation({
    mutationFn: (t: { code: string; libelle: string; actif?: boolean }) => api.post('/admin/types-incident', t),
    onSuccess: () => { refresh(); setNouveau({ code: '', libelle: '' }); setEditCode(null); setError(''); },
    onError: onErr,
  });
  const remove = useMutation({
    mutationFn: (code: string) => api.delete(`/admin/types-incident/${code}`),
    onSuccess: () => { refresh(); setError(''); },
    onError: onErr,
  });

  if (isLoading) return <Loading />;
  if (isError) return <ErrorState />;
  const types = data ?? [];

  return (
    <div>
      <PageHeader
        title="Types d'incident"
        subtitle="Référentiel des formulaires de déclaration (web et mobile) - modifiable sans mise à jour d'application"
        backHref="/administration"
      />

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}

      <div className="mb-4 rounded-xl border border-gray-100 bg-white p-4">
        <p className="mb-3 text-sm font-semibold text-gray-700">Ajouter un type</p>
        <form
          onSubmit={(e) => { e.preventDefault(); save.mutate(nouveau); }}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <Input value={nouveau.code} onChange={(e) => setNouveau((f) => ({ ...f, code: e.target.value }))} placeholder="Code (ex. PANNE_CLIM)" className="sm:w-64" required />
          <Input value={nouveau.libelle} onChange={(e) => setNouveau((f) => ({ ...f, libelle: e.target.value }))} placeholder="Libellé affiché (ex. Panne climatisation)" className="flex-1" required />
          <Button type="submit" icon={Plus} loading={save.isPending}>Ajouter</Button>
        </form>
        <p className="mt-2 text-xs text-gray-400">Le code est normalisé en MAJUSCULES_SOULIGNÉES et sert d&apos;identifiant stable ; le libellé reste modifiable. Le mobile reçoit la liste avec sa configuration - aucune mise à jour d&apos;application nécessaire.</p>
      </div>

      {types.length === 0 ? (
        <EmptyState title="Aucun type" hint="Ajoutez un premier type d'incident." />
      ) : (
        <div className="divide-y divide-gray-50 rounded-xl border border-gray-100 bg-white">
          {types.map((t) => (
            <div key={t.code} className={`flex items-center gap-3 p-3.5 ${t.actif ? '' : 'opacity-50'}`}>
              <code className="w-56 shrink-0 text-xs text-gray-500">{t.code}</code>
              {editCode === t.code ? (
                <>
                  <Input value={editLibelle} onChange={(e) => setEditLibelle(e.target.value)} className="flex-1" autoFocus />
                  <button type="button" className="rounded p-1.5 text-green-600 hover:bg-green-50" onClick={() => save.mutate({ code: t.code, libelle: editLibelle })} title="Enregistrer"><Check size={16} /></button>
                  <button type="button" className="rounded p-1.5 text-gray-400 hover:bg-gray-50" onClick={() => setEditCode(null)} title="Annuler"><X size={16} /></button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm font-medium text-gray-800">
                    {t.libelle}
                    {!t.actif && <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">désactivé</span>}
                  </span>
                  {t.systeme ? (
                    <span className="flex items-center gap-1 text-[11px] text-gray-400" title="Créé par la plateforme (coupures) : renommable, jamais supprimable ni désactivable.">
                      <Lock size={12} /> système
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-xs font-medium text-[#2471A3] hover:bg-[#EAF1F8]"
                      onClick={() => save.mutate({ code: t.code, libelle: t.libelle, actif: !t.actif })}
                    >
                      {t.actif ? 'Désactiver' : 'Réactiver'}
                    </button>
                  )}
                  <button type="button" className="rounded p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600" onClick={() => { setEditCode(t.code); setEditLibelle(t.libelle); }} title="Renommer"><Pencil size={15} /></button>
                  {!t.systeme && (
                    <button
                      type="button"
                      className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                      onClick={() => { if (confirm(`Supprimer le type « ${t.libelle} » ? Refusé s'il est utilisé par des incidents (désactivez-le alors).`)) remove.mutate(t.code); }}
                      title="Supprimer"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
