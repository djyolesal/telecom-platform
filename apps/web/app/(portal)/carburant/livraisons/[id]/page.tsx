'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, AlertTriangle, Plus, X, Trash2, Download, FileText, Pencil } from 'lucide-react';
import { api } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { PageHeader } from '@/components/shared/PageHeader';
import { TableSkeleton, ErrorState } from '@/components/shared/states';
import { Badge } from '@/components/shared/Badge';
import { Button } from '@/components/shared/Button';
import { Field, Input, Select } from '@/components/shared/Form';
import { fmtNumber, fmtDate } from '@/lib/utils';

const MOIS = ['', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const TOL = 0.5;
const BL_COLORS: Record<string, string> = { PLANIFIE: 'bg-amber-100 text-amber-700', CHARGE: 'bg-blue-100 text-blue-700', LIVRE: 'bg-green-100 text-green-700', ANNULE: 'bg-red-100 text-red-700' };
const LIGNE_COLORS: Record<string, string> = { PREVU: 'bg-gray-100 text-gray-600', PARTIEL: 'bg-amber-100 text-amber-700', LIVRE: 'bg-green-100 text-green-700', ANNULE: 'bg-red-100 text-red-700' };

interface SiteLite { id: string; code: string; nom: string }
interface Ligne {
  id: string; volumePrevuLitres: number; volumeLivreReel: number; ecart: number; statut: string;
  site: { code: string; nom: string; region: string };
  depotages: { id: string; dateDepotage: string; volumeLitres: number }[];
}
interface BL {
  id: string; numeroBL: string; mois: number; annee: number; immatriculation: string; numeroClient: string;
  volumeChargeLitres: number; dateChargement: string; dateTraitement?: string; statut: string; observations?: string;
  blPdfPath?: string; bordereauPdfPath?: string;
  bonCommande?: { numero: string; annee: number; trimestre: number };
  transporteur?: { id: string; nom: string };
  lignes: Ligne[]; sommeLignes: number; coherenceCharge: boolean;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex justify-between py-1.5 text-sm border-b last:border-0"><span className="text-gray-500">{label}</span><span className="font-medium text-gray-800">{value}</span></div>;
}

interface LigneEdit { siteId: string; volume: string }

// Éditeur de plan (réservé au manager) : associe des sites + volumes au BL.
function EditPlanModal({ bl, onClose }: { bl: BL; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [lignes, setLignes] = useState<LigneEdit[]>(
    bl.lignes.length ? bl.lignes.map((l) => ({ siteId: '', volume: String(Math.round(l.volumePrevuLitres)) })) : [{ siteId: '', volume: '' }]
  );
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);

  const { data: sites = [] } = useQuery({
    queryKey: ['sites-all'],
    queryFn: () => api.get('/sites', { params: { all: true } }).then((r) => r.data.data as SiteLite[]),
  });

  // Pré-remplit les sites existants une fois la liste chargée.
  const [seeded, setSeeded] = useState(false);
  if (!seeded && sites.length && bl.lignes.length) {
    const byCode = new Map(sites.map((s) => [s.code, s.id]));
    setLignes(bl.lignes.map((l) => ({ siteId: byCode.get(l.site.code) ?? '', volume: String(Math.round(l.volumePrevuLitres)) })));
    setSeeded(true);
  }

  const somme = lignes.reduce((s, l) => s + (Number(l.volume) || 0), 0);
  const charge = Number(bl.volumeChargeLitres);
  const coherent = lignes.every((l) => l.siteId && Number(l.volume) > 0) && Math.abs(somme - charge) <= TOL;

  const mutation = useMutation({
    mutationFn: () => api.put(`/bons-livraison/${bl.id}/plan`, {
      lignes: lignes.filter((l) => l.siteId && Number(l.volume) > 0).map((l) => ({ siteId: l.siteId, volumePrevuLitres: Number(l.volume) })),
    }),
    onSuccess: (r: { data?: { warnings?: string[] } }) => {
      queryClient.invalidateQueries({ queryKey: ['bon-livraison', bl.id] });
      const w = r.data?.warnings ?? [];
      if (w.length) setWarnings(w); else onClose();
    },
    onError: (e: { response?: { data?: { error?: string } } }) => setError(e.response?.data?.error || 'Erreur'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-800">Plan de livraison — {bl.numeroBL}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={18} /></button>
        </div>
        {error && <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>}
        {warnings.length > 0 && (
          <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
            <p className="font-semibold mb-1">Plan enregistré, avec alertes :</p>
            <ul className="list-disc pl-4">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            <div className="mt-2 text-right"><Button type="button" onClick={onClose}>Fermer</Button></div>
          </div>
        )}
        {warnings.length === 0 && (
          <form onSubmit={(e) => { e.preventDefault(); setError(''); mutation.mutate(); }}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-500">Sites à approvisionner</p>
              <button type="button" onClick={() => setLignes((l) => [...l, { siteId: '', volume: '' }])} className="text-sm text-blue-600 flex items-center gap-1"><Plus size={14} /> Ajouter un site</button>
            </div>
            <div className="space-y-2">
              {lignes.map((l, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="flex-1">
                    <Select value={l.siteId} onChange={(e) => setLignes((arr) => arr.map((x, j) => j === i ? { ...x, siteId: e.target.value } : x))}
                      placeholder="— Choisir un site —"
                      options={sites.map((s) => ({ value: s.id, label: `${s.code} — ${s.nom}` }))} />
                  </div>
                  <div className="w-28"><Input type="number" value={l.volume} placeholder="L" onChange={(e) => setLignes((arr) => arr.map((x, j) => j === i ? { ...x, volume: e.target.value } : x))} /></div>
                  <button type="button" onClick={() => setLignes((arr) => arr.filter((_, j) => j !== i))} className="p-1 text-gray-400 hover:text-red-600"><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
            <div className={`mt-3 flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium ${coherent ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
              <span>Total plan : {fmtNumber(somme)} L</span>
              <span>Chargé : {fmtNumber(charge)} L {coherent ? '✓' : `(écart ${fmtNumber(somme - charge)} L)`}</span>
            </div>
            <div className="flex justify-end gap-2 pt-3">
              <Button type="button" variant="secondary" onClick={onClose}>Annuler</Button>
              <Button type="submit" loading={mutation.isPending} disabled={!coherent}>Enregistrer le plan</Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default function BonLivraisonDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role ?? '';
  const isManager = role === 'MANAGER' || role === 'ADMIN';
  const [showPlan, setShowPlan] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['bon-livraison', id],
    queryFn: () => api.get(`/bons-livraison/${id}`).then((r) => r.data.data as BL),
  });

  if (isLoading) return <div className="p-6"><TableSkeleton cols={4} /></div>;
  if (isError || !data) return <div className="p-6"><ErrorState /></div>;

  const totalLivreReel = data.lignes.reduce((s, l) => s + l.volumeLivreReel, 0);
  const hasPlan = data.lignes.length > 0;

  return (
    <div>
      <PageHeader
        title={`Bon de livraison ${data.numeroBL}`}
        subtitle={`${MOIS[data.mois]} ${data.annee} · BC ${data.bonCommande?.numero ?? ''} · Camion ${data.immatriculation}`}
        backHref={`/carburant/livraisons`}
        actions={
          <div className="flex items-center gap-2">
            {hasPlan && <Button variant="secondary" icon={Download} onClick={() => downloadFile(`/bons-livraison/${data.id}/plan.xlsx`, `plan-${data.numeroBL}.xlsx`)}>Excel</Button>}
            {hasPlan && <Button variant="secondary" icon={FileText} onClick={() => downloadFile(`/bons-livraison/${data.id}/plan.pdf`, `plan-${data.numeroBL}.pdf`)}>PDF</Button>}
            {isManager && <Button icon={hasPlan ? Pencil : Plus} onClick={() => setShowPlan(true)}>{hasPlan ? 'Éditer le plan' : 'Générer le plan'}</Button>}
          </div>
        }
      />

      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h3 className="font-semibold text-gray-700 text-sm mb-2">Détails du chargement</h3>
          <Row label="N° client" value={data.numeroClient} />
          <Row label="Transporteur" value={data.transporteur?.nom ?? '—'} />
          <Row label="Camion" value={data.immatriculation} />
          <Row label="Volume chargé" value={`${fmtNumber(Number(data.volumeChargeLitres))} L`} />
          <Row label="Date chargement" value={fmtDate(data.dateChargement)} />
          {data.dateTraitement && <Row label="Date traitement" value={fmtDate(data.dateTraitement)} />}
          {(data.blPdfPath || data.bordereauPdfPath) && (
            <div className="flex gap-2 pt-3">
              {data.blPdfPath && <a href={`/storage/telecom-files/${data.blPdfPath}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50"><FileText size={13} className="text-red-500" /> PDF du BL</a>}
              {data.bordereauPdfPath && <a href={`/storage/telecom-files/${data.bordereauPdfPath}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50"><FileText size={13} className="text-red-500" /> Bordereau</a>}
            </div>
          )}
        </div>
        <div className={`rounded-xl border p-5 ${data.coherenceCharge ? 'border-green-100 bg-green-50/50' : 'border-amber-200 bg-amber-50/60'}`}>
          <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
            {data.coherenceCharge ? <CheckCircle2 size={16} className="text-green-600" /> : <AlertTriangle size={16} className="text-amber-600" />}
            Contrôle de cohérence
          </h3>
          <Row label="Total du plan (prévu)" value={`${fmtNumber(data.sommeLignes)} L`} />
          <Row label="Volume chargé camion" value={`${fmtNumber(Number(data.volumeChargeLitres))} L`} />
          <Row label="Total livré (réel)" value={`${fmtNumber(totalLivreReel)} L`} />
          <p className={`mt-2 text-sm font-medium ${data.coherenceCharge ? 'text-green-700' : 'text-amber-700'}`}>
            {!hasPlan ? 'Plan non encore défini par le manager.' : data.coherenceCharge ? 'Plan cohérent : Σ sites = volume chargé.' : 'Incohérence : la somme des volumes prévus diffère du volume chargé.'}
          </p>
        </div>
      </div>

      {/* Plan de livraison : sites + prévu vs livré réel */}
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h3 className="font-semibold text-gray-700 text-sm mb-3">Plan de livraison ({data.lignes.length} sites)</h3>
        {!hasPlan ? (
          <p className="text-sm text-gray-400">Aucun plan. {isManager ? 'Cliquez sur « Générer le plan » pour associer les sites à ce chargement.' : 'Le manager doit générer le plan.'}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 text-xs border-b">
                <th className="text-left py-2">Site</th>
                <th className="text-left">Région</th>
                <th className="text-right">Prévu (L)</th>
                <th className="text-right">Livré réel (L)</th>
                <th className="text-right">Écart</th>
                <th className="text-left">Statut</th>
              </tr>
            </thead>
            <tbody>
              {data.lignes.map((l) => (
                <tr key={l.id} className="border-b last:border-0">
                  <td className="py-2"><span className="font-medium text-gray-800">{l.site.code}</span> <span className="text-gray-500">{l.site.nom}</span></td>
                  <td className="text-gray-600">{l.site.region}</td>
                  <td className="text-right">{fmtNumber(Number(l.volumePrevuLitres))}</td>
                  <td className="text-right">{l.volumeLivreReel > 0 ? fmtNumber(l.volumeLivreReel) : '—'}</td>
                  <td className={`text-right font-medium ${Math.abs(l.ecart) <= 0.5 ? 'text-gray-400' : l.ecart > 0 ? 'text-blue-600' : 'text-amber-600'}`}>
                    {l.volumeLivreReel > 0 ? `${l.ecart > 0 ? '+' : ''}${fmtNumber(l.ecart)}` : '—'}
                  </td>
                  <td><Badge className={LIGNE_COLORS[l.statut] || ''}>{l.statut}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {data.observations && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 mt-4">
          <h3 className="font-semibold text-gray-700 text-sm mb-1">Observations</h3>
          <p className="text-sm text-gray-600">{data.observations}</p>
        </div>
      )}

      {showPlan && <EditPlanModal bl={data} onClose={() => setShowPlan(false)} />}
    </div>
  );
}
