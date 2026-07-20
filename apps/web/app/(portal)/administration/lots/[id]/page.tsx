'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Search, X } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { Loading, ErrorState, EmptyState } from '@/components/shared/states';
import { Badge } from '@/components/shared/Badge';
import { Button } from '@/components/shared/Button';
import { Select } from '@/components/shared/Form';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { SCOPES_MAINTENANCE, SCOPE_COLORS } from '@/lib/constants';

interface Assignment { id: string; scope: string; prestataire: { id: string; nom: string } }
interface SiteLite { id: string; code: string; nom: string; region: string }
interface Lot { id: string; code: string; nom: string; region?: string; assignments: Assignment[]; sites: SiteLite[] }

const scopeLabel = (s: string) => SCOPES_MAINTENANCE.find((o) => o.value === s)?.label ?? s;

export default function LotDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const { data: lot, isLoading, isError } = useQuery({
    queryKey: ['lot', id],
    queryFn: () => api.get(`/lots/${id}`).then((r) => r.data.data as Lot),
  });
  const { data: prestataires } = useQuery({
    queryKey: ['prestataires-select'],
    queryFn: () => api.get('/prestataires', { params: { is_active: true, limit: 200 } }).then((r) => r.data.data),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['lot', id] });

  // Attribution
  const [prestataireId, setPrestataireId] = useState('');
  const [scope, setScope] = useState('LES_DEUX');
  const addAssignment = useMutation({
    mutationFn: () => api.post(`/lots/${id}/assignments`, { prestataireId, scope }),
    onSuccess: () => { setPrestataireId(''); refresh(); },
  });
  const removeAssignment = useMutation({
    mutationFn: (aid: string) => api.delete(`/lots/${id}/assignments/${aid}`),
    onSuccess: refresh,
  });
  const removeSite = useMutation({
    mutationFn: (siteId: string) => api.delete(`/lots/${id}/sites/${siteId}`),
    onSuccess: refresh,
  });

  if (isLoading) return <Loading />;
  if (isError || !lot) return <ErrorState message="Lot introuvable" />;

  const prestataireOptions = (prestataires ?? []).map((p: { id: string; nom: string }) => ({ value: p.id, label: p.nom }));

  return (
    <div>
      <PageHeader title={`Lot ${lot.code}`} subtitle={`${lot.nom}${lot.region ? ' · ' + lot.region : ''}`} backHref="/administration/lots" />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* ── Attributions ── */}
        <section className="bg-white rounded-xl border border-gray-100 p-5">
          <h3 className="font-semibold text-gray-700 text-sm mb-3">Attributions (prestataire · périmètre)</h3>
          <div className="space-y-2 mb-4">
            {lot.assignments.length === 0 && <EmptyState title="Aucune attribution" hint="Ajoutez un prestataire et son périmètre." />}
            {lot.assignments.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-800 text-sm">{a.prestataire.nom}</span>
                  <Badge className={SCOPE_COLORS[a.scope] || 'bg-gray-100 text-gray-600'}>{scopeLabel(a.scope)}</Badge>
                </div>
                <button onClick={() => removeAssignment.mutate(a.id)} className="p-1 rounded hover:bg-red-50" title="Retirer">
                  <Trash2 size={15} className="text-red-500" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3">
            <div className="flex-1 min-w-[140px]">
              <Select value={prestataireId} onChange={(e) => setPrestataireId(e.target.value)} options={prestataireOptions} placeholder="Prestataire…" />
            </div>
            <Select value={scope} onChange={(e) => setScope(e.target.value)} options={SCOPES_MAINTENANCE} className="w-40" />
            <Button icon={Plus} disabled={!prestataireId} loading={addAssignment.isPending} onClick={() => addAssignment.mutate()}>Ajouter</Button>
          </div>
          {addAssignment.isError && <p className="mt-2 text-xs text-red-500">Cette attribution existe déjà (même prestataire + périmètre).</p>}
        </section>

        {/* ── Sites du lot ── */}
        <section className="bg-white rounded-xl border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-700 text-sm">Sites du lot ({lot.sites.length})</h3>
          </div>
          <div className="space-y-1.5 max-h-72 overflow-y-auto mb-4">
            {lot.sites.length === 0 && <EmptyState title="Aucun site" hint="Affectez des sites à ce lot ci-dessous." />}
            {lot.sites.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg border border-gray-50 px-3 py-1.5 text-sm">
                <span><span className="font-medium text-gray-800">{s.nom}</span> <span className="text-gray-500">· {s.region}</span></span>
                <button onClick={() => removeSite.mutate(s.id)} className="p-1 rounded hover:bg-red-50" title="Retirer du lot">
                  <X size={14} className="text-gray-400" />
                </button>
              </div>
            ))}
          </div>
          <AddSites lotId={id} onDone={refresh} existingIds={new Set(lot.sites.map((s) => s.id))} />
        </section>
      </div>
    </div>
  );
}

// ── Recherche + affectation de sites au lot ──────────────────
function AddSites({ lotId, onDone, existingIds }: { lotId: string; onDone: () => void; existingIds: Set<string> }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const debounced = useDebounce(search);

  const { data, isFetching } = useQuery({
    queryKey: ['sites-search', debounced],
    queryFn: () => api.get('/sites', { params: { search: debounced, limit: 15 } }).then((r) => r.data.data as SiteLite[]),
    enabled: debounced.length >= 2,
  });

  const assign = useMutation({
    mutationFn: () => api.post(`/lots/${lotId}/sites`, { siteIds: Array.from(selected) }),
    onSuccess: () => { setSelected(new Set()); setSearch(''); onDone(); },
  });

  const results = (data ?? []).filter((s) => !existingIds.has(s.id));
  const toggle = (sid: string) => setSelected((prev) => {
    const n = new Set(prev);
    if (n.has(sid)) { n.delete(sid); } else { n.add(sid); }
    return n;
  });

  return (
    <div className="border-t border-gray-100 pt-3">
      <div className="relative mb-2">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher des sites à affecter (≥ 2 caractères)…"
          className="w-full rounded-lg border border-gray-200 pl-9 pr-3 py-2 text-sm focus:border-[#2471A3] outline-none"
        />
      </div>
      {debounced.length >= 2 && (
        <div className="space-y-1 max-h-48 overflow-y-auto mb-2">
          {isFetching && <p className="text-xs text-gray-400 py-2">Recherche…</p>}
          {!isFetching && results.length === 0 && <p className="text-xs text-gray-400 py-2">Aucun site (ou déjà dans le lot).</p>}
          {results.map((s) => (
            <label key={s.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50 cursor-pointer text-sm">
              <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
              <span className="font-medium text-gray-700">{s.nom}</span>
              <span className="text-gray-500">· {s.region}</span>
            </label>
          ))}
        </div>
      )}
      <Button icon={Plus} disabled={selected.size === 0} loading={assign.isPending} onClick={() => assign.mutate()}>
        Affecter {selected.size > 0 ? `(${selected.size})` : ''}
      </Button>
    </div>
  );
}
