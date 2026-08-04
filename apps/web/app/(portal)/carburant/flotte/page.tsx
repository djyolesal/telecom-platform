'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Truck, User, Plus, X, Pencil } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { DataTable, Column } from '@/components/shared/DataTable';
import { TableSkeleton, EmptyState } from '@/components/shared/states';
import { Badge } from '@/components/shared/Badge';
import { Button } from '@/components/shared/Button';
import { Field, Input, Select } from '@/components/shared/Form';
import { fmtNumber } from '@/lib/utils';

interface Vehicule {
  id: string; immatriculation: string; libelle: string;
  capaciteCiterneLitres: number | null; marque: string | null; isActive: boolean;
  prestataire: { id: string; nom: string } | null;
  _count: { bonsLivraison: number };
}
interface Chauffeur {
  id: string; nom: string; telephone: string | null; numeroPermis: string | null; isActive: boolean;
  prestataire: { id: string; nom: string } | null;
  _count: { bonsLivraison: number; depotages: number };
}
interface Transporteur { id: string; nom: string }

/**
 * Les référentiels se peuplent tout seuls : une plaque nomme un camion, un nom
 * nomme un chauffeur. Cette page sert à les ENRICHIR — et la capacité de
 * citerne est le champ qui compte : sans elle, aucun contrôle ne peut dire
 * qu'un chargement de 35 000 L dans un camion de 30 000 est impossible.
 */
export default function FlottePage() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role ?? '';
  const isInterne = role === 'MANAGER' || role === 'ADMIN';
  const [onglet, setOnglet] = useState<'vehicules' | 'chauffeurs'>('vehicules');
  const [editV, setEditV] = useState<Vehicule | 'nouveau' | null>(null);
  const [editC, setEditC] = useState<Chauffeur | 'nouveau' | null>(null);

  const { data: vehicules = [], isLoading: chargeV } = useQuery({
    queryKey: ['vehicules'],
    queryFn: () => api.get('/vehicules', { params: { limit: 200 } }).then((r) => r.data.data as Vehicule[]),
  });
  const { data: chauffeurs = [], isLoading: chargeC } = useQuery({
    queryKey: ['chauffeurs'],
    queryFn: () => api.get('/chauffeurs', { params: { limit: 200 } }).then((r) => r.data.data as Chauffeur[]),
  });

  const colsV: Column<Vehicule>[] = [
    { key: 'libelle', header: 'Camion', render: (v) => <span className="font-medium text-gray-800">{v.libelle}</span> },
    { key: 'marque', header: 'Marque', render: (v) => v.marque ?? '—' },
    {
      key: 'capacite', header: 'Capacité citerne', align: 'right',
      render: (v) => v.capaciteCiterneLitres != null
        ? `${fmtNumber(Number(v.capaciteCiterneLitres))} L`
        // Sans capacité, le contrôle « volume chargé impossible » ne s'applique pas.
        : <span className="text-amber-600" title="Aucun contrôle de dépassement possible">à renseigner</span>,
    },
    { key: 'prestataire', header: 'Transporteur', render: (v) => v.prestataire?.nom ?? '—' },
    { key: 'nbBl', header: 'Chargements', align: 'right', render: (v) => v._count.bonsLivraison },
    { key: 'actif', header: 'État', align: 'center', render: (v) => v.isActive ? <Badge className="bg-green-100 text-green-700">Actif</Badge> : <Badge className="bg-gray-200 text-gray-600">Retiré</Badge> },
    { key: 'actions', header: '', align: 'right', render: (v) => <button onClick={() => setEditV(v)} className="rounded p-1 text-gray-500 hover:bg-gray-100"><Pencil size={15} /></button> },
  ];

  const colsC: Column<Chauffeur>[] = [
    { key: 'nom', header: 'Chauffeur', render: (c) => <span className="font-medium text-gray-800">{c.nom}</span> },
    { key: 'telephone', header: 'Téléphone', render: (c) => c.telephone ?? '—' },
    { key: 'permis', header: 'N° permis', render: (c) => c.numeroPermis ?? '—' },
    { key: 'prestataire', header: 'Transporteur', render: (c) => c.prestataire?.nom ?? '—' },
    { key: 'nb', header: 'Chargements / dépotages', align: 'right', render: (c) => `${c._count.bonsLivraison} / ${c._count.depotages}` },
    { key: 'actif', header: 'État', align: 'center', render: (c) => c.isActive ? <Badge className="bg-green-100 text-green-700">Actif</Badge> : <Badge className="bg-gray-200 text-gray-600">Inactif</Badge> },
    { key: 'actions', header: '', align: 'right', render: (c) => <button onClick={() => setEditC(c)} className="rounded p-1 text-gray-500 hover:bg-gray-100"><Pencil size={15} /></button> },
  ];

  const sansCapacite = vehicules.filter((v) => v.isActive && v.capaciteCiterneLitres == null).length;

  return (
    <div>
      <PageHeader
        title="Flotte de transport"
        subtitle="Camions et chauffeurs — le référentiel se remplit à l'usage, complétez-le pour activer les contrôles"
        backHref="/carburant/commandes"
        actions={
          <Button icon={Plus} onClick={() => (onglet === 'vehicules' ? setEditV('nouveau') : setEditC('nouveau'))}>
            {onglet === 'vehicules' ? 'Nouveau camion' : 'Nouveau chauffeur'}
          </Button>
        }
      />

      {onglet === 'vehicules' && sansCapacite > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {sansCapacite} camion(s) sans capacité de citerne : pour eux, un volume chargé supérieur à la capacité réelle
          passe sans alerte. Renseignez la capacité pour activer le contrôle.
        </div>
      )}

      <div className="mb-4 flex gap-1 border-b border-gray-200">
        {([['vehicules', 'Camions', Truck], ['chauffeurs', 'Chauffeurs', User]] as const).map(([k, label, Icon]) => (
          <button key={k} onClick={() => setOnglet(k)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium ${onglet === k ? 'border-[#1B3F6B] text-[#1B3F6B]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {onglet === 'vehicules' && (chargeV ? <TableSkeleton /> : vehicules.length
        ? <DataTable columns={colsV} data={vehicules} rowKey={(v) => v.id} />
        : <EmptyState title="Aucun camion" hint="Un camion apparaît ici dès qu'un bon de livraison porte son immatriculation." />)}
      {onglet === 'chauffeurs' && (chargeC ? <TableSkeleton /> : chauffeurs.length
        ? <DataTable columns={colsC} data={chauffeurs} rowKey={(c) => c.id} />
        : <EmptyState title="Aucun chauffeur" hint="Un chauffeur apparaît ici dès qu'il est déclaré sur un bon de livraison." />)}

      {editV && <VehiculeModal vehicule={editV === 'nouveau' ? null : editV} isInterne={isInterne} onClose={() => setEditV(null)} />}
      {editC && <ChauffeurModal chauffeur={editC === 'nouveau' ? null : editC} isInterne={isInterne} onClose={() => setEditC(null)} />}
    </div>
  );
}

function useTransporteurs(actif: boolean) {
  return useQuery({
    queryKey: ['transporteurs'],
    queryFn: () => api.get('/prestataires', { params: { is_transporteur: true, is_active: true, limit: 100 } }).then((r) => r.data.data as Transporteur[]),
    enabled: actif,
  });
}

function VehiculeModal({ vehicule, isInterne, onClose }: { vehicule: Vehicule | null; isInterne: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: transporteurs = [] } = useTransporteurs(isInterne);
  const [form, setForm] = useState({
    immatriculation: vehicule?.libelle ?? '',
    capaciteCiterneLitres: vehicule?.capaciteCiterneLitres != null ? String(Math.round(Number(vehicule.capaciteCiterneLitres))) : '',
    marque: vehicule?.marque ?? '',
    prestataireId: vehicule?.prestataire?.id ?? '',
    isActive: vehicule ? vehicule.isActive : true,
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => {
      const corps = {
        immatriculation: form.immatriculation,
        capaciteCiterneLitres: form.capaciteCiterneLitres ? Number(form.capaciteCiterneLitres) : null,
        marque: form.marque || null,
        ...(isInterne ? { prestataireId: form.prestataireId || null } : {}),
        isActive: form.isActive,
      };
      return vehicule ? api.put(`/vehicules/${vehicule.id}`, corps) : api.post('/vehicules', corps);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['vehicules'] }); onClose(); },
    onError: (e: { response?: { data?: { error?: string } } }) => setError(e.response?.data?.error ?? 'Erreur'),
  });

  return (
    <ModaleCadre titre={vehicule ? `Camion ${vehicule.libelle}` : 'Nouveau camion'} onClose={onClose}>
      {error && <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <form onSubmit={(e) => { e.preventDefault(); setError(''); mutation.mutate(); }} className="space-y-3">
        <Field label="Immatriculation" required>
          <Input value={form.immatriculation} onChange={(e) => setForm((f) => ({ ...f, immatriculation: e.target.value }))} required placeholder="TG-1234-AB" />
        </Field>
        <Field label="Capacité de la citerne (L)">
          <Input type="number" value={form.capaciteCiterneLitres} onChange={(e) => setForm((f) => ({ ...f, capaciteCiterneLitres: e.target.value }))} placeholder="30000" />
        </Field>
        <p className="-mt-1 text-xs text-gray-500">
          Renseignée, elle bloque tout bon de livraison dont le volume chargé la dépasse — une saisie physiquement impossible.
        </p>
        <Field label="Marque"><Input value={form.marque} onChange={(e) => setForm((f) => ({ ...f, marque: e.target.value }))} /></Field>
        {isInterne && (
          <Field label="Transporteur">
            <Select value={form.prestataireId} onChange={(e) => setForm((f) => ({ ...f, prestataireId: e.target.value }))} placeholder="—"
              options={transporteurs.map((t) => ({ value: t.id, label: t.nom }))} />
          </Field>
        )}
        {vehicule && (
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} className="h-4 w-4 rounded border-gray-300" />
            Camion en service
          </label>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>Annuler</Button>
          <Button type="submit" loading={mutation.isPending}>Enregistrer</Button>
        </div>
      </form>
    </ModaleCadre>
  );
}

function ChauffeurModal({ chauffeur, isInterne, onClose }: { chauffeur: Chauffeur | null; isInterne: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: transporteurs = [] } = useTransporteurs(isInterne);
  const [form, setForm] = useState({
    nom: chauffeur?.nom ?? '',
    telephone: chauffeur?.telephone ?? '',
    numeroPermis: chauffeur?.numeroPermis ?? '',
    prestataireId: chauffeur?.prestataire?.id ?? '',
    isActive: chauffeur ? chauffeur.isActive : true,
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => {
      const corps = {
        nom: form.nom,
        telephone: form.telephone || null,
        numeroPermis: form.numeroPermis || null,
        ...(isInterne ? { prestataireId: form.prestataireId || null } : {}),
        isActive: form.isActive,
      };
      return chauffeur ? api.put(`/chauffeurs/${chauffeur.id}`, corps) : api.post('/chauffeurs', corps);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['chauffeurs'] }); onClose(); },
    onError: (e: { response?: { data?: { error?: string } } }) => setError(e.response?.data?.error ?? 'Erreur'),
  });

  return (
    <ModaleCadre titre={chauffeur ? chauffeur.nom : 'Nouveau chauffeur'} onClose={onClose}>
      {error && <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <form onSubmit={(e) => { e.preventDefault(); setError(''); mutation.mutate(); }} className="space-y-3">
        <Field label="Nom et prénom" required>
          <Input value={form.nom} onChange={(e) => setForm((f) => ({ ...f, nom: e.target.value }))} required />
        </Field>
        <Field label="Téléphone"><Input value={form.telephone} onChange={(e) => setForm((f) => ({ ...f, telephone: e.target.value }))} /></Field>
        <Field label="N° de permis"><Input value={form.numeroPermis} onChange={(e) => setForm((f) => ({ ...f, numeroPermis: e.target.value }))} /></Field>
        {isInterne && (
          <Field label="Transporteur">
            <Select value={form.prestataireId} onChange={(e) => setForm((f) => ({ ...f, prestataireId: e.target.value }))} placeholder="—"
              options={transporteurs.map((t) => ({ value: t.id, label: t.nom }))} />
          </Field>
        )}
        {chauffeur && (
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} className="h-4 w-4 rounded border-gray-300" />
            Chauffeur en activité
          </label>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>Annuler</Button>
          <Button type="submit" loading={mutation.isPending}>Enregistrer</Button>
        </div>
      </form>
    </ModaleCadre>
  );
}

function ModaleCadre({ titre, onClose, children }: { titre: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-800">{titre}</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-gray-100"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
