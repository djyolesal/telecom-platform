'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { FilterBar } from '@/components/shared/FilterBar';
import { DataTable, Column } from '@/components/shared/DataTable';
import { TableSkeleton, EmptyState, ErrorState } from '@/components/shared/states';
import { Badge } from '@/components/shared/Badge';
import { Button } from '@/components/shared/Button';
import { Field, Input, Select } from '@/components/shared/Form';

interface Actif {
  id: string;
  actifType: string;
  categorie: string;
  numeroSerie: string | null;
  libelle: string | null;
  caracteristique: string | null;
  statutActif: string;
  siteId: string | null;
  site: { code: string; nom: string } | null;
}

const STATUT_COLOR: Record<string, string> = {
  EN_SERVICE: 'bg-green-100 text-green-700',
  EN_STOCK: 'bg-gray-100 text-gray-600',
  EN_TRANSIT: 'bg-amber-100 text-amber-700',
  REFORME: 'bg-red-100 text-red-700',
};
const STATUT_LABEL: Record<string, string> = {
  EN_SERVICE: 'En service', EN_STOCK: 'Au dépôt', EN_TRANSIT: 'En transit', REFORME: 'Réformé',
};
const TYPE_OPTIONS = [
  { value: 'GE', label: 'Groupe électrogène' },
  { value: 'BATTERIE', label: 'Batterie' },
  { value: 'CLIMATISEUR', label: 'Climatiseur' },
];
const STATUT_OPTIONS = [
  { value: 'EN_SERVICE', label: 'En service' },
  { value: 'EN_STOCK', label: 'Au dépôt' },
  { value: 'EN_TRANSIT', label: 'En transit' },
  { value: 'REFORME', label: 'Réformé' },
];

function CreateActifModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ actifType: 'GE', numeroSerie: '', libelle: '', puissanceKva: '', valeur: '', unite: '' });
  const [error, setError] = useState('');
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const isGE = form.actifType === 'GE';

  const mutation = useMutation({
    mutationFn: () => api.post('/actifs', {
      actifType: form.actifType,
      numeroSerie: form.numeroSerie || undefined,
      libelle: form.libelle || undefined,
      puissanceKva: isGE && form.puissanceKva ? Number(form.puissanceKva) : undefined,
      valeur: !isGE && form.valeur ? Number(form.valeur) : undefined,
      unite: !isGE ? form.unite || undefined : undefined,
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['actifs'] }); onClose(); },
    onError: (e: { response?: { data?: { error?: string } } }) => setError(e.response?.data?.error || 'Erreur'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-800">Nouvel actif</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={18} /></button>
        </div>
        <p className="mb-3 text-xs text-gray-500">L’actif est enregistré au dépôt (EN_STOCK). Il sera posé sur un site via un travail d’installation.</p>
        {error && <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>}
        <form onSubmit={(e) => { e.preventDefault(); setError(''); mutation.mutate(); }} className="grid grid-cols-2 gap-3">
          <Field label="Type" required>
            <Select value={form.actifType} onChange={(e) => set('actifType', e.target.value)} options={[{ value: 'GE', label: 'Groupe électrogène' }, { value: 'BATTERIE', label: 'Batterie' }, { value: 'CLIMATISEUR', label: 'Climatiseur' }]} />
          </Field>
          <Field label="N° série"><Input value={form.numeroSerie} onChange={(e) => set('numeroSerie', e.target.value)} /></Field>
          <Field label="Libellé" className="col-span-2"><Input value={form.libelle} onChange={(e) => set('libelle', e.target.value)} placeholder={isGE ? '(auto)' : 'ex. Batterie 200 Ah'} /></Field>
          {isGE ? (
            <Field label="Puissance (kVA)"><Input type="number" value={form.puissanceKva} onChange={(e) => set('puissanceKva', e.target.value)} /></Field>
          ) : (
            <>
              <Field label="Caractéristique"><Input type="number" value={form.valeur} onChange={(e) => set('valeur', e.target.value)} placeholder="ex. 200" /></Field>
              <Field label="Unité"><Input value={form.unite} onChange={(e) => set('unite', e.target.value)} placeholder="Ah, BTU…" /></Field>
            </>
          )}
          <div className="col-span-2 flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>Annuler</Button>
            <Button type="submit" loading={mutation.isPending}>Enregistrer</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ActifsPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role ?? '';
  const canCreate = role === 'MANAGER' || role === 'ADMIN';
  const [showCreate, setShowCreate] = useState(false);
  const [type, setType] = useState('');
  const [statut, setStatut] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['actifs', { type, statut }],
    queryFn: () => api.get('/actifs', { params: { type: type || undefined, statut: statut || undefined } }).then((r) => r.data.data),
  });

  const rows: Actif[] = data ?? [];

  const columns: Column<Actif>[] = [
    { key: 'libelle', header: 'Actif', render: (a) => <span className="font-medium text-gray-800">{a.libelle ?? a.categorie}</span> },
    { key: 'categorie', header: 'Type', render: (a) => TYPE_OPTIONS.find((t) => t.value === a.actifType)?.label ?? a.actifType },
    { key: 'numeroSerie', header: 'N° série', render: (a) => a.numeroSerie || '—' },
    { key: 'caracteristique', header: 'Caractéristique', render: (a) => a.caracteristique || '—' },
    { key: 'statutActif', header: 'Statut', render: (a) => <Badge className={STATUT_COLOR[a.statutActif] || 'bg-gray-100 text-gray-600'}>{STATUT_LABEL[a.statutActif] ?? a.statutActif}</Badge> },
    { key: 'site', header: 'Site', render: (a) => (a.site ? `${a.site.code} — ${a.site.nom}` : <span className="text-gray-400">Dépôt</span>) },
  ];

  return (
    <div>
      <PageHeader
        title="Parc d'actifs"
        subtitle="Groupes électrogènes, batteries, climatiseurs"
        actions={canCreate ? <Button icon={Plus} onClick={() => setShowCreate(true)}>Nouvel actif</Button> : undefined}
      />

      <FilterBar
        filters={[
          { key: 'type', label: 'Tous types', value: type, options: TYPE_OPTIONS, onChange: setType },
          { key: 'statut', label: 'Tous statuts', value: statut, options: STATUT_OPTIONS, onChange: setStatut },
        ]}
      />

      {isLoading ? (
        <TableSkeleton cols={6} />
      ) : isError ? (
        <ErrorState />
      ) : rows.length === 0 ? (
        <EmptyState title="Aucun actif" hint="Enregistrez un GE, une batterie ou un climatiseur." />
      ) : (
        <DataTable columns={columns} data={rows} onRowClick={(a) => router.push(`/actifs/${a.actifType}/${a.id}`)} />
      )}

      {showCreate && <CreateActifModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
