'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { TableSkeleton, ErrorState } from '@/components/shared/states';
import { Badge } from '@/components/shared/Badge';
import { Button } from '@/components/shared/Button';
import { Field, Input, Select, Textarea } from '@/components/shared/Form';
import { fmtNumber, fmtDate } from '@/lib/utils';

const MOIS = ['', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const TOL = 0.5;
const today = () => new Date().toISOString().slice(0, 10);
const BL_COLORS: Record<string, string> = { PLANIFIE: 'bg-amber-100 text-amber-700', CHARGE: 'bg-blue-100 text-blue-700', LIVRE: 'bg-green-100 text-green-700', ANNULE: 'bg-red-100 text-red-700' };

interface Transporteur { id: string; nom: string }
interface Suivi { mois: number; prevu: number; livre: number; ecart: number; depassement: boolean }
interface BL { id: string; numeroBL: string; mois: number; immatriculation: string; volumeChargeLitres: number; dateChargement: string; statut: string; _count?: { lignes: number } }
interface BC {
  id: string; numero: string; annee: number; trimestre: number; numeroClient: string; statut: string; observations?: string; bcPdfPath?: string;
  volumesMensuels: { id: string; mois: number; volumePrevuLitres: number }[];
  bonsLivraison: BL[]; suivi: Suivi[];
}

// Upload d'un PDF → renvoie la clé de stockage.
async function uploadPdf(file: File): Promise<string> {
  const fd = new FormData();
  fd.append('folder', 'documents');
  fd.append('file', file);
  const r = await api.post('/upload/document', fd);
  return r.data?.data?.key as string;
}

function CreateBLModal({ bc, onClose }: { bc: BC; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role ?? '';
  const isManager = role === 'MANAGER' || role === 'ADMIN';
  const moisOpts = bc.volumesMensuels.map((v) => ({ value: String(v.mois), label: MOIS[v.mois] }));
  const [form, setForm] = useState({
    numeroBL: '', immatriculation: '', mois: String(bc.volumesMensuels[0]?.mois ?? new Date().getMonth() + 1),
    volumeChargeLitres: '', dateChargement: today(), transporteurId: '', observations: '',
  });
  const [blPdfPath, setBlPdfPath] = useState('');
  const [bordereauPdfPath, setBordereauPdfPath] = useState('');
  const [uploading, setUploading] = useState('');
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // Liste des transporteurs (visible côté manager pour désigner le transporteur).
  const { data: transporteurs = [] } = useQuery({
    queryKey: ['transporteurs'],
    queryFn: () => api.get('/prestataires', { params: { is_transporteur: true, is_active: true, limit: 100 } }).then((r) => r.data.data as Transporteur[]),
    enabled: isManager,
  });

  const doUpload = async (file: File, slot: 'bl' | 'bordereau') => {
    setUploading(slot);
    try {
      const key = await uploadPdf(file);
      if (slot === 'bl') setBlPdfPath(key); else setBordereauPdfPath(key);
    } catch { setError('Échec de l’upload du PDF.'); }
    finally { setUploading(''); }
  };

  const mutation = useMutation({
    mutationFn: () => api.post('/bons-livraison', {
      bonCommandeId: bc.id,
      numeroBL: form.numeroBL,
      mois: parseInt(form.mois),
      annee: bc.annee,
      immatriculation: form.immatriculation,
      volumeChargeLitres: Number(form.volumeChargeLitres) || 0,
      dateChargement: form.dateChargement,
      transporteurId: isManager && form.transporteurId ? form.transporteurId : undefined,
      blPdfPath: blPdfPath || undefined,
      bordereauPdfPath: bordereauPdfPath || undefined,
      observations: form.observations || undefined,
    }),
    onSuccess: (r: { data?: { warnings?: string[] } }) => {
      queryClient.invalidateQueries({ queryKey: ['bon-commande', bc.id] });
      const w = r.data?.warnings ?? [];
      if (w.length) { setWarnings(w); } else { onClose(); }
    },
    onError: (e: { response?: { data?: { error?: string } } }) => setError(e.response?.data?.error || 'Erreur'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-800">Nouveau bon de livraison</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={18} /></button>
        </div>
        <p className="text-xs text-gray-500 mb-3">Renseignez le chargement et joignez les PDF. Le plan de livraison sera défini par le manager.</p>
        {error && <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>}
        {warnings.length > 0 && (
          <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
            <p className="font-semibold mb-1">Bon de livraison créé, avec alertes :</p>
            <ul className="list-disc pl-4">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            <div className="mt-2 text-right"><Button type="button" onClick={onClose}>Fermer</Button></div>
          </div>
        )}
        <form onSubmit={(e) => { e.preventDefault(); setError(''); mutation.mutate(); }} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="N° bon de livraison" required><Input value={form.numeroBL} onChange={(e) => set('numeroBL', e.target.value)} required placeholder="BL-00123" /></Field>
            <Field label="Immatriculation camion" required><Input value={form.immatriculation} onChange={(e) => set('immatriculation', e.target.value)} required placeholder="TG-1234-AB" /></Field>
            <Field label="Mois exécuté" required><Select value={form.mois} onChange={(e) => set('mois', e.target.value)} options={moisOpts} /></Field>
            <Field label="Date chargement" required><Input type="date" value={form.dateChargement} onChange={(e) => set('dateChargement', e.target.value)} required /></Field>
            <Field label="Volume chargé (L)" required><Input type="number" value={form.volumeChargeLitres} onChange={(e) => set('volumeChargeLitres', e.target.value)} required placeholder="0" /></Field>
            {isManager && (
              <Field label="Transporteur">
                <Select value={form.transporteurId} onChange={(e) => set('transporteurId', e.target.value)} placeholder="—"
                  options={transporteurs.map((t) => ({ value: t.id, label: t.nom }))} />
              </Field>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="PDF du bon de livraison">
              <div className="flex items-center gap-2 text-xs">
                <input type="file" accept="application/pdf" onChange={(e) => { const f = e.target.files?.[0]; if (f) doUpload(f, 'bl'); }} />
                {uploading === 'bl' && <span className="text-gray-400">Envoi…</span>}
                {blPdfPath && uploading !== 'bl' && <span className="text-green-600">✓</span>}
              </div>
            </Field>
            <Field label="PDF du bordereau de chargement">
              <div className="flex items-center gap-2 text-xs">
                <input type="file" accept="application/pdf" onChange={(e) => { const f = e.target.files?.[0]; if (f) doUpload(f, 'bordereau'); }} />
                {uploading === 'bordereau' && <span className="text-gray-400">Envoi…</span>}
                {bordereauPdfPath && uploading !== 'bordereau' && <span className="text-green-600">✓</span>}
              </div>
            </Field>
          </div>

          <Field label="Observations"><Textarea value={form.observations} onChange={(e) => set('observations', e.target.value)} rows={2} /></Field>
          {warnings.length === 0 && (
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={onClose}>Annuler</Button>
              <Button type="submit" loading={mutation.isPending} disabled={!!uploading}>Créer</Button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

export default function BonCommandeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['bon-commande', id],
    queryFn: () => api.get(`/bons-commande/${id}`).then((r) => r.data.data as BC),
  });

  if (isLoading) return <div className="p-6"><TableSkeleton cols={4} /></div>;
  if (isError || !data) return <div className="p-6"><ErrorState /></div>;

  const totalPrevu = data.suivi.reduce((s, v) => s + v.prevu, 0);
  const totalLivre = data.suivi.reduce((s, v) => s + v.livre, 0);

  return (
    <div>
      <PageHeader
        title={`Bon de commande ${data.numero}`}
        subtitle={`T${data.trimestre} ${data.annee} · Client ${data.numeroClient}`}
        backHref="/carburant/commandes"
        actions={<Button icon={Plus} onClick={() => setShowModal(true)}>Nouveau bon de livraison</Button>}
      />

      {data.bcPdfPath && (
        <a href={`/storage/telecom-files/${data.bcPdfPath}`} target="_blank" rel="noopener noreferrer"
          className="mb-4 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
          <FileText size={15} className="text-red-500" /> PDF de la commande
        </a>
      )}

      {/* Suivi prévu vs livré par mois */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 mb-4">
        <h3 className="font-semibold text-gray-700 text-sm mb-3">Suivi commandé vs livré</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500 text-xs border-b">
              <th className="text-left py-2">Mois</th>
              <th className="text-right">Prévu (L)</th>
              <th className="text-right">Livré (L)</th>
              <th className="text-right">Écart</th>
            </tr>
          </thead>
          <tbody>
            {data.suivi.map((v) => (
              <tr key={v.mois} className="border-b last:border-0">
                <td className="py-2">{MOIS[v.mois]}</td>
                <td className="text-right">{fmtNumber(v.prevu)}</td>
                <td className="text-right">{fmtNumber(v.livre)}</td>
                <td className={`text-right font-medium ${v.depassement ? 'text-red-600' : v.ecart < -TOL ? 'text-amber-600' : 'text-green-600'}`}>
                  {v.ecart > 0 ? '+' : ''}{fmtNumber(v.ecart)}
                </td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="py-2">Total</td>
              <td className="text-right">{fmtNumber(totalPrevu)}</td>
              <td className="text-right">{fmtNumber(totalLivre)}</td>
              <td className={`text-right ${totalLivre > totalPrevu + TOL ? 'text-red-600' : 'text-gray-700'}`}>{totalLivre - totalPrevu > 0 ? '+' : ''}{fmtNumber(totalLivre - totalPrevu)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Bons de livraison rattachés */}
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h3 className="font-semibold text-gray-700 text-sm mb-3">Bons de livraison ({data.bonsLivraison.length})</h3>
        {data.bonsLivraison.length === 0 ? (
          <p className="text-sm text-gray-400">Aucun bon de livraison. Créez-en un pour exécuter les volumes du mois.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 text-xs border-b">
                <th className="text-left py-2">N° BL</th>
                <th className="text-left">Mois</th>
                <th className="text-left">Camion</th>
                <th className="text-right">Volume (L)</th>
                <th className="text-center">Sites</th>
                <th className="text-left">Date</th>
                <th className="text-left">Statut</th>
              </tr>
            </thead>
            <tbody>
              {data.bonsLivraison.map((bl) => (
                <tr key={bl.id} className="border-b last:border-0 cursor-pointer hover:bg-gray-50" onClick={() => router.push(`/carburant/livraisons/${bl.id}`)}>
                  <td className="py-2 font-medium text-gray-800">{bl.numeroBL}</td>
                  <td>{MOIS[bl.mois]}</td>
                  <td>{bl.immatriculation}</td>
                  <td className="text-right">{fmtNumber(Number(bl.volumeChargeLitres))}</td>
                  <td className="text-center">{bl._count?.lignes ?? 0}</td>
                  <td>{fmtDate(bl.dateChargement)}</td>
                  <td><Badge className={BL_COLORS[bl.statut] || ''}>{bl.statut}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && <CreateBLModal bc={data} onClose={() => setShowModal(false)} />}
    </div>
  );
}
