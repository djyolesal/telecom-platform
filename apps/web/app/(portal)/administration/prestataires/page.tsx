'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Power, X, Pencil } from 'lucide-react';
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
  email?: string;
  adresse?: string;
  rccm?: string;
  nif?: string;
  contactCommercial?: string;
  contactTechnique?: string;
  logoPath?: string;
  isTransporteur?: boolean;
  isGardiennage?: boolean;
  isActive: boolean;
  _count?: { assignments: number; sitesGardes?: number };
}

function PrestataireModal({ prestataire, onClose }: { prestataire: Prestataire | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const editing = !!prestataire;
  const [form, setForm] = useState({
    nom: prestataire?.nom ?? '', email: prestataire?.email ?? '',
    adresse: prestataire?.adresse ?? '', rccm: prestataire?.rccm ?? '', nif: prestataire?.nif ?? '',
    contactCommercial: prestataire?.contactCommercial ?? '', contactTechnique: prestataire?.contactTechnique ?? '',
    logoPath: prestataire?.logoPath ?? '',
  });
  const [error, setError] = useState('');
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [isTransporteur, setIsTransporteur] = useState(prestataire?.isTransporteur ?? false);
  const [isGardiennage, setIsGardiennage] = useState(prestataire?.isGardiennage ?? false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const uploadLogo = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('folder', 'logos');
      fd.append('file', file);
      const r = await api.post('/upload/image', fd);
      if (r.data?.data) { set('logoPath', r.data.data.key); setLogoPreview(r.data.data.url); }
    } catch { setError('Échec de l’upload du logo.'); }
    finally { setUploading(false); }
  };

  const payload = () => ({ ...Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v || undefined])), isTransporteur, isGardiennage });
  const mutation = useMutation({
    mutationFn: () => editing ? api.put(`/prestataires/${prestataire!.id}`, payload()) : api.post('/prestataires', payload()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['prestataires'] }); onClose(); },
    onError: (e: { response?: { data?: { error?: string } } }) => setError(e.response?.data?.error || 'Erreur'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-800">{editing ? `Modifier — ${prestataire!.nom}` : 'Nouveau prestataire'}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={18} /></button>
        </div>
        {error && <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>}
        <form onSubmit={(e) => { e.preventDefault(); setError(''); mutation.mutate(); }} className="grid grid-cols-2 gap-3">
          <Field label="Nom" required className="col-span-2"><Input value={form.nom} onChange={(e) => set('nom', e.target.value)} required /></Field>
          <Field label="Email" className="col-span-2"><Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></Field>

          <div className="col-span-2 mt-1 border-t border-gray-100 pt-2 text-xs font-semibold text-gray-500">Coordonnées (en-tête de la fiche de validation)</div>
          <Field label="Adresse" className="col-span-2"><Input value={form.adresse} onChange={(e) => set('adresse', e.target.value)} placeholder="Rue 30 HDN, Hedzranawoé — BP 4960 Lomé" /></Field>
          <Field label="RCCM"><Input value={form.rccm} onChange={(e) => set('rccm', e.target.value)} placeholder="TG-LOM 2019 M 908" /></Field>
          <Field label="NIF"><Input value={form.nif} onChange={(e) => set('nif', e.target.value)} placeholder="1001134806" /></Field>
          <Field label="Contact commercial"><Input value={form.contactCommercial} onChange={(e) => set('contactCommercial', e.target.value)} placeholder="+228 …" /></Field>
          <Field label="Contact technique"><Input value={form.contactTechnique} onChange={(e) => set('contactTechnique', e.target.value)} placeholder="+228 …" /></Field>

          <Field label="Logo (fiche de validation)" className="col-span-2">
            <div className="flex items-center gap-3">
              {(logoPreview || form.logoPath) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoPreview ?? `/storage/telecom-files/${form.logoPath}`} alt="logo" className="h-12 w-auto rounded border border-gray-100 object-contain" />
              )}
              <input type="file" accept="image/png,image/jpeg" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo(f); }} className="text-xs" />
              {uploading && <span className="text-xs text-gray-400">Envoi…</span>}
            </div>
          </Field>

          <label className="col-span-2 flex items-center gap-2 mt-1 cursor-pointer text-sm text-gray-700">
            <input type="checkbox" checked={isTransporteur} onChange={(e) => setIsTransporteur(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
            Prestataire transporteur (carburant) — peut saisir les bons de livraison
          </label>
          <label className="col-span-2 flex items-center gap-2 cursor-pointer text-sm text-gray-700">
            <input type="checkbox" checked={isGardiennage} onChange={(e) => setIsGardiennage(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
            Société de gardiennage — les sites qu&apos;elle garde lui sont rattachés (pas d&apos;accès plateforme)
          </label>

          <div className="col-span-2 flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>Annuler</Button>
            <Button type="submit" loading={mutation.isPending}>{editing ? 'Enregistrer' : 'Créer'}</Button>
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
  const [modal, setModal] = useState<Prestataire | 'new' | null>(null);
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
    { key: 'nom', header: 'Nom', render: (p) => (
      <span className="font-medium text-gray-800">
        {p.nom}
        {p.isTransporteur && <Badge className="ml-2 bg-blue-50 text-blue-700">Transporteur</Badge>}
        {p.isGardiennage && <Badge className="ml-2 bg-amber-50 text-amber-700">Gardiennage</Badge>}
      </span>
    ) },
    { key: 'contacts', header: 'Contacts (com. / tech.)', render: (p) => `${p.contactCommercial || '—'} / ${p.contactTechnique || '—'}` },
    { key: 'email', header: 'Email', render: (p) => p.email || '—' },
    { key: 'lots', header: 'Lots attribués', align: 'center', render: (p) => p._count?.assignments ?? 0 },
    { key: 'sitesGardes', header: 'Sites gardés', align: 'center', render: (p) => p.isGardiennage ? (p._count?.sitesGardes ?? 0) : '—' },
    { key: 'isActive', header: 'Statut', render: (p) => <Badge className={p.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}>{p.isActive ? 'Actif' : 'Inactif'}</Badge> },
    {
      key: 'actions', header: '', align: 'right', render: (p) => (
        <div className="flex items-center justify-end gap-1">
          <button onClick={() => setModal(p)} title="Modifier" className="p-1.5 rounded hover:bg-gray-100">
            <Pencil size={15} className="text-gray-500" />
          </button>
          <button onClick={() => toggle.mutate(p.id)} title={p.isActive ? 'Désactiver' : 'Activer'} className="p-1.5 rounded hover:bg-gray-100">
            <Power size={15} className={p.isActive ? 'text-green-600' : 'text-gray-400'} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Prestataires"
        subtitle="Sociétés de maintenance externes"
        backHref="/administration"
        actions={<Button icon={Plus} onClick={() => setModal('new')}>Nouveau prestataire</Button>}
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

      {modal && <PrestataireModal prestataire={modal === 'new' ? null : modal} onClose={() => setModal(null)} />}
    </div>
  );
}
