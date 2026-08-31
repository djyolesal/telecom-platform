'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Droplets, ReceiptText, Plus, X, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { DataTable, Column } from '@/components/shared/DataTable';
import { TableSkeleton, EmptyState } from '@/components/shared/states';
import { Badge } from '@/components/shared/Badge';
import { Button } from '@/components/shared/Button';
import { Field, Input, Textarea } from '@/components/shared/Form';
import { SearchSelect } from '@/components/shared/SearchSelect';
import { fmtNumber, fmtDate } from '@/lib/utils';

interface SiteLite { id: string; code: string; nom: string }
interface BcLite { id: string; numero: string }
interface Mouvement {
  id: string; reference: string | null; type: string; volumeLitres: number;
  dateMouvement: string; motif: string; documentUrl: string | null;
  site: SiteLite | null; contrepartie: SiteLite | null;
  bonCommande: { id: string; numero: string } | null;
  auteur: { id: string; nom: string } | null;
}

const TYPES: Record<string, { label: string; classe: string; signe: string }> = {
  TRANSFERT_SORTIE:  { label: 'Transfert (départ)',  classe: 'bg-amber-100 text-amber-700',  signe: '−' },
  TRANSFERT_ENTREE:  { label: 'Transfert (arrivée)', classe: 'bg-blue-100 text-blue-700',    signe: '+' },
  PURGE:             { label: 'Purge de cuve',        classe: 'bg-gray-200 text-gray-700',   signe: '−' },
  AVOIR_FOURNISSEUR: { label: 'Avoir fournisseur',    classe: 'bg-violet-100 text-violet-700', signe: '−' },
};

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Les trois écritures que le terrain faisait déjà sans pouvoir les enregistrer :
 * transfert entre sites (qui obligeait à inventer un faux dépotage, lequel
 * déclenchait une fausse alerte de vol chez le donneur), purge de cuve (comptée
 * en surconsommation) et avoir fournisseur (impossible, volumes négatifs
 * refusés partout).
 */
export default function MouvementsCarburantPage() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role ?? '';
  const peutEcrire = role === 'MANAGER' || role === 'ADMIN';
  const [modale, setModale] = useState<'transfert' | 'purge' | 'avoir' | null>(null);
  const queryClient = useQueryClient();

  const { data: mouvements = [], isLoading } = useQuery({
    queryKey: ['mouvements-carburant'],
    queryFn: () => api.get('/mouvements-carburant', { params: { limit: 200 } }).then((r) => r.data.data as Mouvement[]),
  });

  const supprimer = useMutation({
    mutationFn: (id: string) => api.delete(`/mouvements-carburant/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mouvements-carburant'] }),
    onError: (e: { response?: { data?: { error?: string } } }) => window.alert(e.response?.data?.error ?? 'Suppression impossible'),
  });

  const cols: Column<Mouvement>[] = [
    { key: 'date', header: 'Date', render: (m) => fmtDate(m.dateMouvement) },
    { key: 'type', header: 'Type', render: (m) => <Badge className={TYPES[m.type]?.classe ?? ''}>{TYPES[m.type]?.label ?? m.type}</Badge> },
    {
      key: 'ou', header: 'Site / commande',
      render: (m) => m.site
        ? <span className="text-gray-800">{m.site.nom ?? m.site.code}{m.contrepartie ? <span className="text-gray-500"> ↔ {m.contrepartie.nom ?? m.contrepartie.code}</span> : null}</span>
        : <span className="text-gray-800">BC {m.bonCommande?.numero ?? '—'}</span>,
    },
    {
      key: 'volume', header: 'Volume (L)', align: 'right',
      render: (m) => (
        <span className={TYPES[m.type]?.signe === '+' ? 'font-semibold text-blue-600' : 'font-semibold text-amber-700'}>
          {TYPES[m.type]?.signe}{fmtNumber(Number(m.volumeLitres))}
        </span>
      ),
    },
    { key: 'motif', header: 'Motif', render: (m) => <span className="text-gray-600">{m.motif}</span> },
    { key: 'auteur', header: 'Saisi par', render: (m) => m.auteur?.nom ?? '—' },
    {
      key: 'actions', header: '', align: 'right',
      render: (m) => role === 'ADMIN' ? (
        <button
          onClick={() => {
            // Un transfert part avec ses DEUX jambes : n'en retirer qu'une
            // créerait ou détruirait du carburant dans le bilan du parc.
            const avert = m.type.startsWith('TRANSFERT')
              ? 'Supprimer ce transfert ? Les deux écritures (départ et arrivée) seront retirées.'
              : 'Supprimer ce mouvement ?';
            if (window.confirm(avert)) supprimer.mutate(m.id);
          }}
          className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={15} />
        </button>
      ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Mouvements de carburant"
        subtitle="Transferts entre sites, purges de cuve et avoirs fournisseur - hors chaîne bon de commande → livraison"
        backHref="/carburant/stock"
        actions={peutEcrire ? (
          <div className="flex gap-2">
            <Button variant="secondary" icon={ArrowLeftRight} onClick={() => setModale('transfert')}>Transfert</Button>
            <Button variant="secondary" icon={Droplets} onClick={() => setModale('purge')}>Purge</Button>
            <Button variant="secondary" icon={ReceiptText} onClick={() => setModale('avoir')}>Avoir</Button>
          </div>
        ) : undefined}
      />

      <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
        Ces écritures font sortir ou entrer du carburant sans pièce de livraison : elles sont toutes motivées et tracées.
        Un transfert s’écrit en deux temps (départ et arrivée) - neutre au bilan du parc, mais visible des deux côtés.
        Une purge sort la consommation du calcul de surconsommation, au lieu de la faire passer pour un vol.
      </div>

      {isLoading ? <TableSkeleton /> : mouvements.length
        ? <DataTable columns={cols} data={mouvements} rowKey={(m) => m.id} />
        : <EmptyState title="Aucun mouvement" hint="Transfert entre sites, purge de cuve ou avoir fournisseur apparaîtront ici." />}

      {modale === 'transfert' && <TransfertModal onClose={() => setModale(null)} />}
      {modale === 'purge' && <PurgeModal onClose={() => setModale(null)} />}
      {modale === 'avoir' && <AvoirModal onClose={() => setModale(null)} />}
    </div>
  );
}

function useSites() {
  return useQuery({
    queryKey: ['sites-all'],
    queryFn: () => api.get('/sites', { params: { all: true } }).then((r) => r.data.data as SiteLite[]),
  });
}

function Cadre({ titre, aide, onClose, children }: { titre: string; aide: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-800">{titre}</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-gray-100"><X size={18} /></button>
        </div>
        <p className="mb-4 text-xs text-gray-500">{aide}</p>
        {children}
      </div>
    </div>
  );
}

function useCreation(url: string, onClose: () => void, setError: (s: string) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (corps: Record<string, unknown>) => api.post(url, corps),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mouvements-carburant'] });
      queryClient.invalidateQueries({ queryKey: ['stock-carburant'] });
      onClose();
    },
    onError: (e: { response?: { data?: { error?: string } } }) => setError(e.response?.data?.error ?? 'Erreur'),
  });
}

function TransfertModal({ onClose }: { onClose: () => void }) {
  const { data: sites = [] } = useSites();
  const [form, setForm] = useState({ source: '', destination: '', volume: '', date: today(), motif: '' });
  const [error, setError] = useState('');
  const mutation = useCreation('/mouvements-carburant/transfert', onClose, setError);

  return (
    <Cadre titre="Transfert entre sites" onClose={onClose}
      aide="Le carburant quitte une cuve pour une autre. Deux écritures sont créées : le site donneur n’apparaîtra plus comme ayant perdu du gasoil.">
      {error && <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <form onSubmit={(e) => {
        e.preventDefault(); setError('');
        mutation.mutate({
          siteSourceId: form.source, siteDestinationId: form.destination,
          volumeLitres: Number(form.volume) || 0, dateMouvement: form.date, motif: form.motif,
        });
      }} className="space-y-3">
        <Field label="Site de départ" required>
          <SearchSelect value={form.source} onChange={(v) => setForm((f) => ({ ...f, source: v }))} placeholder="Rechercher un site (nom ou code)…"
            options={sites.map((s) => ({ value: s.id, label: `${s.code} - ${s.nom}` }))} />
        </Field>
        <Field label="Site d’arrivée" required>
          <SearchSelect value={form.destination} onChange={(v) => setForm((f) => ({ ...f, destination: v }))} placeholder="Rechercher un site (nom ou code)…"
            options={sites.filter((s) => s.id !== form.source).map((s) => ({ value: s.id, label: `${s.code} - ${s.nom}` }))} />
        </Field>
        <Field label="Volume transféré (L)" required>
          <Input type="number" value={form.volume} onChange={(e) => setForm((f) => ({ ...f, volume: e.target.value }))} required />
        </Field>
        <Field label="Date" required>
          <Input type="date" max={today()} value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} required />
        </Field>
        <Field label="Motif" required>
          <Textarea rows={2} value={form.motif} onChange={(e) => setForm((f) => ({ ...f, motif: e.target.value }))} required
            placeholder="Ex. dépannage du site en rupture avant la prochaine tournée" />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>Annuler</Button>
          <Button type="submit" loading={mutation.isPending}
            disabled={!form.source || !form.destination || form.motif.trim().length < 10}>Enregistrer</Button>
        </div>
      </form>
    </Cadre>
  );
}

function PurgeModal({ onClose }: { onClose: () => void }) {
  const { data: sites = [] } = useSites();
  const [form, setForm] = useState({ site: '', volume: '', date: today(), motif: '' });
  const [error, setError] = useState('');
  const mutation = useCreation('/mouvements-carburant/purge', onClose, setError);

  return (
    <Cadre titre="Purge / vidange de cuve" onClose={onClose}
      aide="Du carburant sort de la cuve sans être brûlé par le groupe. Sans cette écriture, la baisse ressortait en surconsommation - donc en soupçon de vol.">
      {error && <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <form onSubmit={(e) => {
        e.preventDefault(); setError('');
        mutation.mutate({ siteId: form.site, volumeLitres: Number(form.volume) || 0, dateMouvement: form.date, motif: form.motif });
      }} className="space-y-3">
        <Field label="Site" required>
          <SearchSelect value={form.site} onChange={(v) => setForm((f) => ({ ...f, site: v }))} placeholder="Rechercher un site (nom ou code)…"
            options={sites.map((s) => ({ value: s.id, label: `${s.code} - ${s.nom}` }))} />
        </Field>
        <Field label="Volume purgé (L)" required>
          <Input type="number" value={form.volume} onChange={(e) => setForm((f) => ({ ...f, volume: e.target.value }))} required />
        </Field>
        <Field label="Date" required>
          <Input type="date" max={today()} value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} required />
        </Field>
        <Field label="Motif" required>
          <Textarea rows={2} value={form.motif} onChange={(e) => setForm((f) => ({ ...f, motif: e.target.value }))} required
            placeholder="Ex. eau dans la cuve, vidange avant réparation du groupe" />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>Annuler</Button>
          <Button type="submit" loading={mutation.isPending} disabled={!form.site || form.motif.trim().length < 10}>Enregistrer</Button>
        </div>
      </form>
    </Cadre>
  );
}

function AvoirModal({ onClose }: { onClose: () => void }) {
  const { data: bcs = [] } = useQuery({
    queryKey: ['bcs-options'],
    queryFn: () => api.get('/bons-commande', { params: { limit: 100 } }).then((r) => r.data.data as BcLite[]),
  });
  const [form, setForm] = useState({ bc: '', volume: '', date: today(), motif: '' });
  const [error, setError] = useState('');
  const mutation = useCreation('/mouvements-carburant/avoir', onClose, setError);

  return (
    <Cadre titre="Avoir / reprise fournisseur" onClose={onClose}
      aide="Volume repris par le fournisseur sur une commande. Il ne touche aucune cuve : il vient en déduction du chargé dans le rapprochement trimestriel.">
      {error && <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <form onSubmit={(e) => {
        e.preventDefault(); setError('');
        mutation.mutate({ bonCommandeId: form.bc, volumeLitres: Number(form.volume) || 0, dateMouvement: form.date, motif: form.motif });
      }} className="space-y-3">
        <Field label="Bon de commande" required>
          <SearchSelect value={form.bc} onChange={(v) => setForm((f) => ({ ...f, bc: v }))} placeholder="Rechercher un bon de commande…"
            options={bcs.map((b) => ({ value: b.id, label: b.numero }))} />
        </Field>
        <Field label="Volume repris (L)" required>
          <Input type="number" value={form.volume} onChange={(e) => setForm((f) => ({ ...f, volume: e.target.value }))} required />
        </Field>
        <Field label="Date" required>
          <Input type="date" max={today()} value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} required />
        </Field>
        <Field label="Motif" required>
          <Textarea rows={2} value={form.motif} onChange={(e) => setForm((f) => ({ ...f, motif: e.target.value }))} required
            placeholder="Ex. avoir n°… pour livraison non conforme du 12/03" />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>Annuler</Button>
          <Button type="submit" loading={mutation.isPending} disabled={!form.bc || form.motif.trim().length < 10}>Enregistrer</Button>
        </div>
      </form>
    </Cadre>
  );
}
