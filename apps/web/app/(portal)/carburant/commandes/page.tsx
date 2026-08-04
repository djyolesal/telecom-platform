'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Download, GitCompare, AlertTriangle, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { ExportButtons } from '@/components/shared/ExportButtons';
import { PageHeader } from '@/components/shared/PageHeader';
import { DataTable, Column } from '@/components/shared/DataTable';
import { Pagination, PaginationMeta } from '@/components/shared/Pagination';
import { TableSkeleton, EmptyState, ErrorState } from '@/components/shared/states';
import { Badge } from '@/components/shared/Badge';
import { Button, ButtonLink } from '@/components/shared/Button';
import { Field, Input, Select, Textarea } from '@/components/shared/Form';
import { fmtNumber } from '@/lib/utils';

const MOIS = ['', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const moisDuTrimestre = (t: number) => [t * 3 - 2, t * 3 - 1, t * 3];
const STATUT_COLORS: Record<string, string> = { OUVERT: 'bg-blue-100 text-blue-700', CLOTURE: 'bg-gray-100 text-gray-600', ANNULE: 'bg-red-100 text-red-700' };

interface VolumeMensuel { id: string; mois: number; volumePrevuLitres: number }
interface BonCommande {
  id: string; numero: string; annee: number; trimestre: number; numeroClient: string | null; statut: string;
  volumesMensuels: VolumeMensuel[]; _count?: { bonsLivraison: number };
}

function CreateModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const annee = new Date().getFullYear();
  const [form, setForm] = useState({ numero: '', annee: String(annee), trimestre: '1', numeroClient: '', observations: '' });
  const [volumes, setVolumes] = useState<Record<number, string>>({});
  const [bcPdfPath, setBcPdfPath] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [avertissements, setAvertissements] = useState<string[]>([]);
  const [analyse, setAnalyse] = useState<'aucune' | 'ocr' | 'texte' | 'sans'>('aucune');
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const mois = moisDuTrimestre(parseInt(form.trimestre));

  interface AnalyseBC {
    numero: string | null; annee: number | null; trimestre: number | null;
    volumesMensuels: { mois: number; volumePrevuLitres: number }[];
    totalLitres: number; totalAnnonceLitres: number | null;
    avertissements: string[]; ocr: boolean; bcPdfPath: string;
  }

  /**
   * Le PDF du BC est ANALYSÉ côté serveur (texte natif ou OCR d'un scan) et le
   * formulaire est pré-rempli — l'utilisateur relit et corrige avant de créer :
   * le but est d'éviter les fautes de recopie, pas de créer sans contrôle.
   */
  const analyserPdf = async (file: File) => {
    setUploading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.post('/bons-commande/analyser-pdf', fd);
      const d = r.data?.data as AnalyseBC;
      setBcPdfPath(d.bcPdfPath);
      setForm((f) => ({
        ...f,
        numero: d.numero ?? f.numero,
        annee: d.annee ? String(d.annee) : f.annee,
        trimestre: d.trimestre ? String(d.trimestre) : f.trimestre,
      }));
      if (d.volumesMensuels.length) {
        setVolumes(Object.fromEntries(d.volumesMensuels.map((v) => [v.mois, String(v.volumePrevuLitres)])));
      }
      setAvertissements(d.avertissements);
      setAnalyse(d.ocr ? 'ocr' : 'texte');
    } catch (e) {
      // Analyse indisponible (outils absents) ou PDF illisible : on retombe sur
      // un simple archivage du PDF — le formulaire reste à saisir à la main.
      try {
        const fd = new FormData();
        fd.append('folder', 'documents');
        fd.append('file', file);
        const r = await api.post('/upload/document', fd);
        if (r.data?.data) setBcPdfPath(r.data.data.key);
        const msg = (e as { response?: { data?: { error?: string } } }).response?.data?.error;
        setAvertissements([`Analyse impossible (${msg ?? 'erreur'}) — PDF joint, saisie manuelle.`]);
        setAnalyse('sans');
      } catch { setError('Échec de l’upload du PDF.'); }
    } finally { setUploading(false); }
  };

  const mutation = useMutation({
    mutationFn: () => api.post('/bons-commande', {
      numero: form.numero,
      annee: parseInt(form.annee),
      trimestre: parseInt(form.trimestre),
      numeroClient: form.numeroClient || undefined,
      observations: form.observations || undefined,
      bcPdfPath: bcPdfPath || undefined,
      volumesMensuels: mois
        .filter((m) => volumes[m] && Number(volumes[m]) > 0)
        .map((m) => ({ mois: m, volumePrevuLitres: Number(volumes[m]) })),
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['bons-commande'] }); onClose(); },
    onError: (e: { response?: { data?: { error?: string } } }) => setError(e.response?.data?.error || 'Erreur'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-800">Nouveau bon de commande</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={18} /></button>
        </div>
        {error && <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>}
        <form onSubmit={(e) => { e.preventDefault(); setError(''); mutation.mutate(); }} className="space-y-3">
          <div className="rounded-lg border border-dashed border-[#1B3F6B]/40 bg-[#EAF1F8]/50 p-3">
            <p className="mb-1.5 text-xs font-semibold text-[#1B3F6B]">
              PDF du bon de commande <span className="text-red-500">*</span>
              <span className="font-normal text-gray-500"> — pré-remplit le formulaire</span>
            </p>
            <p className="mb-1.5 text-[11px] text-gray-500">
              C'est la pièce signée qui engage les volumes du trimestre : elle est obligatoire et reste jointe au bon de commande.
            </p>
            <div className="flex items-center gap-3">
              <input type="file" accept="application/pdf" onChange={(e) => { const f = e.target.files?.[0]; if (f) analyserPdf(f); }} className="text-xs" />
              {uploading && <span className="text-xs text-gray-500">Analyse en cours…</span>}
              {!uploading && analyse === 'ocr' && <span className="text-xs font-medium text-emerald-700">Scan lu par OCR ✓ — vérifiez les valeurs</span>}
              {!uploading && analyse === 'texte' && <span className="text-xs font-medium text-emerald-700">PDF lu ✓ — vérifiez les valeurs</span>}
              {!uploading && analyse === 'sans' && bcPdfPath && <span className="text-xs text-amber-700">PDF joint (sans analyse)</span>}
              {!uploading && !bcPdfPath && <span className="text-xs text-amber-600">requis</span>}
            </div>
            {avertissements.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs text-amber-700">
                {avertissements.map((a, i) => <li key={i}>⚠ {a}</li>)}
              </ul>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Numéro BC" required><Input value={form.numero} onChange={(e) => set('numero', e.target.value)} required placeholder="PO250100005" /></Field>
            <Field label="Numéro client (optionnel)"><Input value={form.numeroClient} onChange={(e) => set('numeroClient', e.target.value)} placeholder="—" /></Field>
            <Field label="Année" required><Input type="number" value={form.annee} onChange={(e) => set('annee', e.target.value)} required /></Field>
            <Field label="Trimestre" required>
              <Select value={form.trimestre} onChange={(e) => set('trimestre', e.target.value)}
                options={[1, 2, 3, 4].map((t) => ({ value: String(t), label: `T${t}` }))} />
            </Field>
          </div>
          <div className="rounded-lg border border-gray-200 p-3">
            <p className="text-xs font-semibold text-gray-500 mb-2">Volumes prévus par mois (L)</p>
            <div className="space-y-2">
              {mois.map((m) => (
                <div key={m} className="flex items-center gap-2">
                  <span className="w-24 text-sm text-gray-600">{MOIS[m]}</span>
                  <Input type="number" value={volumes[m] ?? ''} onChange={(e) => setVolumes((v) => ({ ...v, [m]: e.target.value }))} placeholder="0" />
                </div>
              ))}
            </div>
          </div>
          {bcPdfPath && <p className="text-xs text-green-600">PDF de la commande joint ✓</p>}
          <Field label="Observations"><Textarea value={form.observations} onChange={(e) => set('observations', e.target.value)} rows={2} /></Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>Annuler</Button>
            <Button type="submit" loading={mutation.isPending} disabled={uploading || !bcPdfPath}>Créer</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function BonsCommandePage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  // Le transporteur CONSULTE les bons de commande (pour y rattacher ses
  // chargements) mais ne les crée pas : création, modification, export et
  // rapports de pilotage sont réservés MANAGER/ADMIN côté API. Sans ce test, il
  // voyait cinq actions qui ne pouvaient que renvoyer 403 ou « accès refusé »,
  // y compris le lien de retour vers une page hors de son périmètre.
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role ?? '';
  const peutGerer = role === 'MANAGER' || role === 'ADMIN';

  const { data, isLoading, isError } = useQuery({
    queryKey: ['bons-commande', { page }],
    queryFn: () => api.get('/bons-commande', { params: { page, limit: 20 } }).then((r) => r.data),
  });

  const rows: BonCommande[] = data?.data ?? [];
  const meta: PaginationMeta | undefined = data?.meta;

  const columns: Column<BonCommande>[] = [
    { key: 'numero', header: 'N° BC', render: (b) => <span className="font-medium text-gray-800">{b.numero}</span> },
    { key: 'periode', header: 'Période', render: (b) => `T${b.trimestre} ${b.annee}` },
    { key: 'client', header: 'Client', render: (b) => b.numeroClient ?? '—' },
    { key: 'volume', header: 'Volume prévu (L)', align: 'right', render: (b) => fmtNumber(b.volumesMensuels.reduce((s, v) => s + Number(v.volumePrevuLitres), 0)) },
    { key: 'bl', header: 'Livraisons', align: 'center', render: (b) => b._count?.bonsLivraison ?? 0 },
    { key: 'statut', header: 'Statut', render: (b) => <Badge className={STATUT_COLORS[b.statut] || ''}>{b.statut}</Badge> },
  ];

  return (
    <div>
      <PageHeader
        title="Bons de commande carburant"
        subtitle={peutGerer
          ? 'Commandes trimestrielles et volumes mensuels'
          : 'Commandes en cours — ouvrez-en une pour y déclarer un chargement'}
        backHref={peutGerer ? '/carburant/stock' : '/dashboard'}
        actions={peutGerer ? (
          <div className="flex gap-2">
            <ButtonLink href="/carburant/reapprovisionnement" variant="secondary" icon={Sparkles}>Réappro prédictif</ButtonLink>
            <ButtonLink href="/carburant/manquants" variant="secondary" icon={AlertTriangle}>Manquants</ButtonLink>
            <ButtonLink href="/carburant/correlation" variant="secondary" icon={GitCompare}>Corrélation conso</ButtonLink>
            <ExportButtons base="/bons-commande/export" name="bons-commande" />
            <Button icon={Plus} onClick={() => setShowModal(true)}>Nouveau bon de commande</Button>
          </div>
        ) : undefined}
      />

      {isLoading ? (
        <TableSkeleton cols={6} />
      ) : isError ? (
        <ErrorState />
      ) : rows.length === 0 ? (
        <EmptyState title="Aucun bon de commande" hint="Créez un bon de commande trimestriel pour démarrer le suivi des approvisionnements." />
      ) : (
        <>
          <DataTable columns={columns} data={rows} onRowClick={(b) => router.push(`/carburant/commandes/${b.id}`)} />
          <Pagination meta={meta} onChange={setPage} />
        </>
      )}

      {showModal && <CreateModal onClose={() => setShowModal(false)} />}
    </div>
  );
}
