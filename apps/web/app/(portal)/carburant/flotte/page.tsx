'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Truck, User, Plus, X, Pencil, FileText } from 'lucide-react';
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
  // Certificat de jaugeage : la pièce qui rend le volume chargé opposable.
  certificatJaugeageNumero: string | null;
  certificatJaugeageExpiration: string | null;
  certificatJaugeageUrl: string | null;
  statutJaugeage: 'VALIDE' | 'EXPIRE_BIENTOT' | 'EXPIRE' | 'ABSENT';
}

const JAUGEAGE_BADGE: Record<Vehicule['statutJaugeage'], { label: string; classe: string }> = {
  VALIDE: { label: 'Valide', classe: 'bg-green-100 text-green-700' },
  EXPIRE_BIENTOT: { label: 'Expire bientôt', classe: 'bg-amber-100 text-amber-700' },
  EXPIRE: { label: 'Expiré', classe: 'bg-red-100 text-red-700' },
  ABSENT: { label: 'À fournir', classe: 'bg-gray-200 text-gray-600' },
};
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
    {
      key: 'jaugeage', header: 'Jaugeage', align: 'center',
      render: (v) => {
        const b = JAUGEAGE_BADGE[v.statutJaugeage] ?? JAUGEAGE_BADGE.ABSENT;
        return (
          <span className="inline-flex items-center gap-1.5">
            <Badge className={b.classe}>{b.label}</Badge>
            {v.certificatJaugeageUrl && (
              <a href={v.certificatJaugeageUrl} target="_blank" rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()} title="Voir le certificat"
                className="text-gray-400 hover:text-gray-700"><FileText size={14} /></a>
            )}
          </span>
        );
      },
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
  const jaugeageKo = vehicules.filter((v) => v.isActive && (v.statutJaugeage === 'EXPIRE' || v.statutJaugeage === 'ABSENT')).length;

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

      {onglet === 'vehicules' && jaugeageKo > 0 && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {jaugeageKo} camion(s) actif(s) sans certificat de jaugeage valide : les volumes chargés sur ces citernes
          ne sont pas opposables en cas de litige. Joignez le certificat et son échéance sur la fiche du camion.
        </div>
      )}
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
    certificatJaugeageNumero: vehicule?.certificatJaugeageNumero ?? '',
    certificatJaugeageExpiration: vehicule?.certificatJaugeageExpiration ? vehicule.certificatJaugeageExpiration.slice(0, 10) : '',
  });
  const [certificatPath, setCertificatPath] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  // Scan du certificat → clé MinIO (même canal que les documents des BL).
  const envoyerCertificat = async (f: File | undefined) => {
    if (!f) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('folder', 'documents');
      fd.append('file', f);
      const r = await api.post('/upload/document', fd);
      setCertificatPath(r.data?.data?.key as string);
    } catch { setError('Envoi du certificat impossible'); }
    finally { setUploading(false); }
  };

  const mutation = useMutation({
    mutationFn: () => {
      const corps = {
        immatriculation: form.immatriculation,
        capaciteCiterneLitres: form.capaciteCiterneLitres ? Number(form.capaciteCiterneLitres) : null,
        marque: form.marque || null,
        ...(isInterne ? { prestataireId: form.prestataireId || null } : {}),
        isActive: form.isActive,
        certificatJaugeageNumero: form.certificatJaugeageNumero || null,
        certificatJaugeageExpiration: form.certificatJaugeageExpiration || null,
        // On n'écrase la pièce existante que si un nouveau scan a été envoyé.
        ...(certificatPath ? { certificatJaugeagePath: certificatPath } : {}),
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

        {/* ── Certificat de jaugeage : la pièce qui rend le volume opposable ── */}
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="mb-2 text-xs font-semibold text-gray-700">Certificat de jaugeage</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="N° du certificat">
              <Input value={form.certificatJaugeageNumero} onChange={(e) => setForm((f) => ({ ...f, certificatJaugeageNumero: e.target.value }))} placeholder="CJ-2026-…" />
            </Field>
            <Field label="Date d'expiration">
              <Input type="date" value={form.certificatJaugeageExpiration} onChange={(e) => setForm((f) => ({ ...f, certificatJaugeageExpiration: e.target.value }))} />
            </Field>
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs">
            <input type="file" accept="application/pdf,image/*" onChange={(e) => envoyerCertificat(e.target.files?.[0])} />
            {uploading && <span className="text-gray-400">Envoi…</span>}
            {certificatPath && !uploading && <span className="text-green-600">✓ nouveau scan joint</span>}
            {!certificatPath && vehicule?.certificatJaugeageUrl && !uploading && (
              <a href={vehicule.certificatJaugeageUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">certificat actuel</a>
            )}
          </div>
          <p className="mt-1.5 text-[11px] text-gray-500">
            Sans certificat valide, le volume chargé s'appuie sur un barème non opposable : chaque bon de livraison
            créé avec ce camion portera un avertissement.
          </p>
        </div>
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
          <Button type="submit" loading={mutation.isPending} disabled={uploading}>Enregistrer</Button>
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
