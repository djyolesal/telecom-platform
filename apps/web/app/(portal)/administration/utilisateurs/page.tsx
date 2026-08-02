'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Download, Power, KeyRound, Pencil, X, SmartphoneNfc } from 'lucide-react';
import { api } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { ExportButtons } from '@/components/shared/ExportButtons';
import { PageHeader } from '@/components/shared/PageHeader';
import { FilterBar } from '@/components/shared/FilterBar';
import { DataTable, Column } from '@/components/shared/DataTable';
import { Pagination, PaginationMeta } from '@/components/shared/Pagination';
import { TableSkeleton, EmptyState, ErrorState } from '@/components/shared/states';
import { Badge } from '@/components/shared/Badge';
import { Button } from '@/components/shared/Button';
import { Field, Input, Select } from '@/components/shared/Form';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { ROLES, regionOptions } from '@/lib/constants';
import { fmtDateTime } from '@/lib/utils';

interface User {
  id: string;
  nom: string;
  prenom: string;
  email: string;
  role: string;
  region?: string;
  isActive: boolean;
  lastLoginAt?: string;
  appareilLabel?: string | null;
  appareilLieLe?: string | null;
  equipe?: string;
  prestataire?: { id: string; nom: string };
}

const EQUIPES = [{ value: 'PASSIVE', label: 'Passive' }, { value: 'ACTIVE', label: 'Active' }];

function CreateModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ nom: '', prenom: '', email: '', telephone: '', role: 'TECHNICIEN', region: '', password: '', prestataireId: '', equipe: '' });
  const [error, setError] = useState('');
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const { data: prestataires } = useQuery({
    queryKey: ['prestataires-select'],
    queryFn: () => api.get('/prestataires', { params: { is_active: true, limit: 200 } }).then((r) => r.data.data),
  });
  const prestataireOptions = (prestataires ?? []).map((p: { id: string; nom: string }) => ({ value: p.id, label: p.nom }));

  const mutation = useMutation({
    mutationFn: () => api.post('/users', {
      ...form,
      region: form.region || undefined,
      password: form.password || undefined,
      prestataireId: form.prestataireId || undefined,
      equipe: form.equipe || undefined,
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['users'] }); onClose(); },
    onError: (e: { response?: { data?: { error?: string } } }) => setError(e.response?.data?.error || 'Erreur'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-800">Nouvel utilisateur</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={18} /></button>
        </div>
        {error && <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>}
        <form onSubmit={(e) => { e.preventDefault(); setError(''); mutation.mutate(); }} className="grid grid-cols-2 gap-3">
          <Field label="Prénom" required><Input value={form.prenom} onChange={(e) => set('prenom', e.target.value)} required /></Field>
          <Field label="Nom" required><Input value={form.nom} onChange={(e) => set('nom', e.target.value)} required /></Field>
          <Field label="Email" required className="col-span-2"><Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} required /></Field>
          <Field label="Téléphone"><Input value={form.telephone} onChange={(e) => set('telephone', e.target.value)} /></Field>
          <Field label="Rôle" required><Select value={form.role} onChange={(e) => set('role', e.target.value)} options={ROLES} /></Field>
          <Field label="Région"><Select value={form.region} onChange={(e) => set('region', e.target.value)} options={regionOptions} placeholder="—" /></Field>
          <Field label="Prestataire"><Select value={form.prestataireId} onChange={(e) => set('prestataireId', e.target.value)} options={prestataireOptions} placeholder="(interne)" /></Field>
          <Field label="Équipe"><Select value={form.equipe} onChange={(e) => set('equipe', e.target.value)} options={EQUIPES} placeholder="—" /></Field>
          <Field label="Mot de passe" className="col-span-2"><Input type="text" value={form.password} onChange={(e) => set('password', e.target.value)} placeholder="(auto si vide)" /></Field>
          <div className="col-span-2 flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>Annuler</Button>
            <Button type="submit" loading={mutation.isPending}>Créer</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditModal({ user, onClose }: { user: User; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    nom: user.nom,
    prenom: user.prenom,
    email: user.email,
    role: user.role,
    region: user.region ?? '',
    prestataireId: user.prestataire?.id ?? '',
    equipe: user.equipe ?? '',
    password: '',
  });
  const [error, setError] = useState('');
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const { data: prestataires } = useQuery({
    queryKey: ['prestataires-select'],
    queryFn: () => api.get('/prestataires', { params: { is_active: true, limit: 200 } }).then((r) => r.data.data),
  });
  const prestataireOptions = (prestataires ?? []).map((p: { id: string; nom: string }) => ({ value: p.id, label: p.nom }));

  const mutation = useMutation({
    mutationFn: () => api.put(`/users/${user.id}`, {
      nom: form.nom,
      prenom: form.prenom,
      email: form.email,
      role: form.role,
      region: form.region || null,
      prestataireId: form.prestataireId || null,
      equipe: form.equipe || null,
      password: form.password || undefined, // vide = inchangé
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['users'] }); onClose(); },
    onError: (e: { response?: { data?: { error?: string } } }) => setError(e.response?.data?.error || 'Erreur'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-800">Modifier l’utilisateur</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={18} /></button>
        </div>
        {error && <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>}
        <form onSubmit={(e) => { e.preventDefault(); setError(''); mutation.mutate(); }} className="grid grid-cols-2 gap-3">
          <Field label="Prénom" required><Input value={form.prenom} onChange={(e) => set('prenom', e.target.value)} required /></Field>
          <Field label="Nom" required><Input value={form.nom} onChange={(e) => set('nom', e.target.value)} required /></Field>
          <Field label="Email" required className="col-span-2"><Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} required /></Field>
          <Field label="Rôle" required><Select value={form.role} onChange={(e) => set('role', e.target.value)} options={ROLES} /></Field>
          <Field label="Région"><Select value={form.region} onChange={(e) => set('region', e.target.value)} options={regionOptions} placeholder="—" /></Field>
          <Field label="Prestataire"><Select value={form.prestataireId} onChange={(e) => set('prestataireId', e.target.value)} options={prestataireOptions} placeholder="(interne)" /></Field>
          <Field label="Équipe"><Select value={form.equipe} onChange={(e) => set('equipe', e.target.value)} options={EQUIPES} placeholder="—" /></Field>
          <Field label="Nouveau mot de passe" className="col-span-2"><Input type="text" value={form.password} onChange={(e) => set('password', e.target.value)} placeholder="(laisser vide pour ne pas changer)" /></Field>
          <div className="col-span-2 flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>Annuler</Button>
            <Button type="submit" loading={mutation.isPending}>Enregistrer</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function UtilisateursPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const debounced = useDebounce(search);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['users', { page, debounced, role }],
    queryFn: () => api.get('/users', { params: { page, limit: 20, search: debounced || undefined, role: role || undefined } }).then((r) => r.data),
  });

  const toggle = useMutation({
    mutationFn: (id: string) => api.post(`/users/${id}/toggle-active`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });
  const reset = useMutation({ mutationFn: (id: string) => api.post(`/users/${id}/reset-password`) });
  const delier = useMutation({
    mutationFn: (id: string) => api.post(`/users/${id}/delier-appareil`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });

  const rows: User[] = data?.data ?? [];
  const meta: PaginationMeta | undefined = data?.meta;

  const columns: Column<User>[] = [
    { key: 'nom', header: 'Nom', render: (u) => <span className="font-medium text-gray-800">{u.prenom} {u.nom}</span> },
    { key: 'email', header: 'Email' },
    { key: 'role', header: 'Rôle', render: (u) => ROLES.find((r) => r.value === u.role)?.label ?? u.role },
    { key: 'prestataire', header: 'Prestataire', render: (u) => (u.prestataire ? `${u.prestataire.nom}${u.equipe ? ` (${u.equipe === 'PASSIVE' ? 'passive' : 'active'})` : ''}` : 'Interne') },
    { key: 'region', header: 'Région', render: (u) => u.region || '—' },
    { key: 'isActive', header: 'Statut', render: (u) => <Badge className={u.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}>{u.isActive ? 'Actif' : 'Inactif'}</Badge> },
    { key: 'lastLoginAt', header: 'Dernière connexion', render: (u) => fmtDateTime(u.lastLoginAt) },
    {
      key: 'appareil', header: 'Appareil lié',
      render: (u) => u.appareilLabel
        ? <span className="text-xs text-gray-600" title={`Lié le ${fmtDateTime(u.appareilLieLe)}`}>{u.appareilLabel}</span>
        : <span className="text-xs text-gray-300">—</span>,
    },
    {
      key: 'actions', header: '', align: 'right', render: (u) => (
        <div className="flex justify-end gap-1">
          <button onClick={() => setEditUser(u)} title="Modifier" className="p-1.5 rounded hover:bg-gray-100"><Pencil size={15} className="text-gray-500" /></button>
          <button onClick={() => toggle.mutate(u.id)} title={u.isActive ? 'Désactiver' : 'Activer'} className="p-1.5 rounded hover:bg-gray-100"><Power size={15} className={u.isActive ? 'text-green-600' : 'text-gray-400'} /></button>
          <button onClick={() => { if (confirm(`Réinitialiser le mot de passe de ${u.prenom} ${u.nom} ?`)) reset.mutate(u.id); }} title="Réinitialiser le mot de passe" className="p-1.5 rounded hover:bg-gray-100"><KeyRound size={15} className="text-gray-500" /></button>
          {u.appareilLabel && (
            <button
              onClick={() => { if (confirm(`Délier l'appareil « ${u.appareilLabel} » de ${u.prenom} ${u.nom} ?\nLe prochain téléphone qui se connectera deviendra le nouvel appareil lié.`)) delier.mutate(u.id); }}
              title={`Délier l'appareil (${u.appareilLabel})`}
              className="p-1.5 rounded hover:bg-gray-100"
            >
              <SmartphoneNfc size={15} className="text-[#7D3C98]" />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Utilisateurs"
        backHref="/administration"
        actions={
          <>
            <button type="button" onClick={() => downloadFile('/users/export/csv', 'utilisateurs.csv')} className="inline-flex items-center gap-2 rounded-lg bg-white border border-gray-200 px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              <Download size={15} /> CSV
            </button>
            <ExportButtons base="/users/export" name="utilisateurs" />
            <Button icon={Plus} onClick={() => setShowModal(true)}>Nouvel utilisateur</Button>
          </>
        }
      />

      <FilterBar
        search={search}
        onSearch={(v) => { setSearch(v); setPage(1); }}
        searchPlaceholder="Rechercher (nom, email)…"
        filters={[{ key: 'role', label: 'Tous rôles', value: role, options: ROLES, onChange: (v) => { setRole(v); setPage(1); } }]}
      />

      {isLoading ? (
        <TableSkeleton cols={7} />
      ) : isError ? (
        <ErrorState />
      ) : rows.length === 0 ? (
        <EmptyState title="Aucun utilisateur" />
      ) : (
        <>
          <DataTable columns={columns} data={rows} />
          <Pagination meta={meta} onChange={setPage} />
        </>
      )}

      {showModal && <CreateModal onClose={() => setShowModal(false)} />}
      {editUser && <EditModal user={editUser} onClose={() => setEditUser(null)} />}
    </div>
  );
}
