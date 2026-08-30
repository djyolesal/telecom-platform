'use client';

import { useState } from 'react';
import { L_STATUT_BC, L_STATUT_BL } from '@/lib/constants';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, FileText, Scale } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { Loading, ErrorState } from '@/components/shared/states';
import { Badge } from '@/components/shared/Badge';
import { Button } from '@/components/shared/Button';
import { Field, Input, Select, Textarea } from '@/components/shared/Form';
import { fmtNumber, fmtDate } from '@/lib/utils';

const MOIS = ['', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const TOL = 0.5;
const today = () => new Date().toISOString().slice(0, 10);
const BL_COLORS: Record<string, string> = { PLANIFIE: 'bg-amber-100 text-amber-700', CHARGE: 'bg-blue-100 text-blue-700', LIVRE: 'bg-green-100 text-green-700', ANNULE: 'bg-red-100 text-red-700' };

interface Transporteur { id: string; nom: string }
interface Suivi { mois: number; prevu: number; charge: number; livre: number; ecart: number; depassement: boolean; enCours: number }
interface BL { id: string; numeroBL: string; mois: number; immatriculation: string; volumeChargeLitres: number; dateChargement: string; statut: string; isBrouillon?: boolean; _count?: { lignes: number } }
interface BC {
  id: string; numero: string; annee: number; trimestre: number; numeroClient: string | null; statut: string; observations?: string; bcPdfPath?: string;
  /** URL signée fournie par l'API (le bucket n'est plus lisible par son chemin). */
  bcPdfUrl?: string | null;
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
    // Date de chargement SANS valeur par défaut : elle ne figure pas sur le BL
    // (la date du document est celle du traitement) - saisie manuelle obligatoire.
    volumeChargeLitres: '', dateChargement: '', transporteurId: '', observations: '',
    // Chauffeur DÉCLARÉ avant le départ du dépôt : c'est lui qui sera confronté
    // au chauffeur qui signe réellement sur site.
    nomChauffeur: '',
  });
  const [dateTraitement, setDateTraitement] = useState('');
  const [blPdfPath, setBlPdfPath] = useState('');
  const [bordereauPdfPath, setBordereauPdfPath] = useState('');
  const [uploading, setUploading] = useState('');
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  interface BlExtrait {
    page: number; numeroBL: string | null; bcNumero: string | null; dateBL: string | null;
    dateTraitement: string | null; numeroClient: string | null;
    immatriculation: string | null; volumeChargeLitres: number | null; avertissements: string[];
  }
  const [extraits, setExtraits] = useState<BlExtrait[]>([]);
  const [pageChoisie, setPageChoisie] = useState<number | null>(null);
  const [numeroClient, setNumeroClient] = useState<string | null>(null);
  const [avertissements, setAvertissements] = useState<string[]>([]);
  const [analysing, setAnalysing] = useState(false);

  /** JJ/MM/AAAA → AAAA-MM-JJ pour l'input date. */
  const isoDe = (d: string | null) => (d ? `${d.slice(6)}-${d.slice(3, 5)}-${d.slice(0, 2)}` : null);

  const appliquerExtrait = (d: BlExtrait) => {
    setPageChoisie(d.page);
    setNumeroClient(d.numeroClient);
    setForm((f) => ({
      ...f,
      numeroBL: d.numeroBL ?? f.numeroBL,
      immatriculation: d.immatriculation ?? f.immatriculation,
      volumeChargeLitres: d.volumeChargeLitres != null ? String(d.volumeChargeLitres) : f.volumeChargeLitres,
      // La date de traitement est celle qui SUIT le n° de bon de commande sur le
      // document (« BC N°PO… / 04.08.2025 ») - jamais la date de chargement, qui
      // ne figure pas sur le papier et reste à saisir à la main.
    }));
    setDateTraitement(isoDe(d.dateTraitement) ?? '');
    const av = [...d.avertissements];
    // Le BL référence son BC : alerter si ce n'est pas celui de la page courante.
    if (d.bcNumero && d.bcNumero !== bc.numero) {
      av.unshift(`⚠ Ce BL référence le bon de commande ${d.bcNumero}, mais vous êtes sur ${bc.numero} - vérifiez.`);
    }
    setAvertissements(av);
  };

  /** PDF du BL analysé côté serveur (OCR si scan) → champs pré-remplis. */
  const analyserBl = async (file: File) => {
    setAnalysing(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.post('/bons-livraison/analyser-document', fd);
      const d = r.data?.data as { documents: BlExtrait[]; documentPath: string };
      setBlPdfPath(d.documentPath);
      setExtraits(d.documents);
      if (d.documents.length) appliquerExtrait(d.documents[0]);
    } catch (e) {
      // Analyse impossible : on archive quand même le PDF, saisie manuelle.
      try {
        const key = await uploadPdf(file);
        setBlPdfPath(key);
        const msg = (e as { response?: { data?: { error?: string } } }).response?.data?.error;
        setAvertissements([`Analyse impossible (${msg ?? 'erreur'}) - PDF joint, saisie manuelle.`]);
      } catch { setError('L’envoi du PDF a échoué. Réessayez ou choisissez un autre fichier.'); }
    } finally { setAnalysing(false); }
  };

  // Chauffeurs déjà connus : proposés en autocomplétion pour éviter d'inventer
  // une troisième graphie du même nom (le référentiel se peuple à l'usage).
  const { data: chauffeurs = [] } = useQuery({
    queryKey: ['chauffeurs-options'],
    queryFn: () => api.get('/chauffeurs', { params: { actifs: true, limit: 200 } }).then((r) => r.data.data as { id: string; nom: string }[]),
  });

  // Liste des transporteurs (visible côté manager pour désigner le transporteur).
  const { data: transporteurs = [] } = useQuery({
    queryKey: ['transporteurs'],
    queryFn: () => api.get('/prestataires', { params: { is_transporteur: true, is_active: true, limit: 100 } }).then((r) => r.data.data as Transporteur[]),
    enabled: isManager,
  });

  // Le PDF du BL est joint par la zone de pré-remplissage ; ne reste que le bordereau.
  const doUpload = async (file: File, slot: 'bordereau') => {
    setUploading(slot);
    try {
      const key = await uploadPdf(file);
      setBordereauPdfPath(key);
    } catch { setError('L’envoi du PDF a échoué. Réessayez ou choisissez un autre fichier.'); }
    finally { setUploading(''); }
  };

  const mutation = useMutation({
    mutationFn: () => api.post('/bons-livraison', {
      bonCommandeId: bc.id,
      numeroBL: form.numeroBL,
      numeroClient: numeroClient || undefined,
      mois: parseInt(form.mois),
      annee: bc.annee,
      immatriculation: form.immatriculation,
      volumeChargeLitres: Number(form.volumeChargeLitres) || 0,
      dateChargement: form.dateChargement,
      dateTraitement: dateTraitement || undefined,
      transporteurId: isManager && form.transporteurId ? form.transporteurId : undefined,
      nomChauffeur: form.nomChauffeur,
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
          <div className="rounded-lg border border-dashed border-[#1B3F6B]/40 bg-[#EAF1F8]/50 p-3">
            <p className="mb-1.5 text-xs font-semibold text-[#1B3F6B]">
              PDF du bon de livraison <span className="text-red-500">*</span>
              <span className="font-normal text-gray-500"> - pré-remplit le formulaire (un lot de plusieurs BL est accepté)</span>
            </p>
            <p className="mb-1.5 text-[11px] text-gray-500">
              Ce PDF est la pièce du chargement : il est obligatoire et reste joint au bon de livraison.
            </p>
            <div className="flex items-center gap-3">
              <input type="file" accept="application/pdf,image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) analyserBl(f); }} className="text-xs" />
              {analysing && <span className="text-xs text-gray-500">Analyse en cours…</span>}
              {!analysing && extraits.length > 0 && <span className="text-xs font-medium text-emerald-700">{extraits.length} BL reconnu(s) ✓ - vérifiez, et saisissez la date de chargement</span>}
              {!analysing && !blPdfPath && <span className="text-xs text-amber-600">requis</span>}
            </div>
            {extraits.length > 1 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {extraits.map((d) => (
                  <button key={d.page} type="button" onClick={() => appliquerExtrait(d)}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium ${pageChoisie === d.page ? 'border-[#1B3F6B] bg-[#1B3F6B] text-white' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>
                    {d.numeroBL ?? `page ${d.page}`}{d.volumeChargeLitres ? ` · ${d.volumeChargeLitres.toLocaleString('fr-FR')} L` : ''}
                  </button>
                ))}
              </div>
            )}
            {avertissements.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs text-amber-700">
                {avertissements.map((a, i) => <li key={i}>{a.startsWith('⚠') ? a : `⚠ ${a}`}</li>)}
              </ul>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="N° bon de livraison" required><Input value={form.numeroBL} onChange={(e) => set('numeroBL', e.target.value)} required placeholder="BL-00123" /></Field>
            <Field label="Immatriculation camion" required><Input value={form.immatriculation} onChange={(e) => set('immatriculation', e.target.value)} required placeholder="TG-1234-AB" /></Field>
            <Field label="Mois exécuté" required><Select value={form.mois} onChange={(e) => set('mois', e.target.value)} options={moisOpts} /></Field>
            <Field label="Date chargement (saisie manuelle)" required><Input type="date" max={today()} value={form.dateChargement} onChange={(e) => set('dateChargement', e.target.value)} required /></Field>
            <Field label="Volume chargé (L)" required><Input type="number" value={form.volumeChargeLitres} onChange={(e) => set('volumeChargeLitres', e.target.value)} required placeholder="0" /></Field>
            {/* Le chauffeur déclaré ici est confronté au signataire du dépotage :
                un camion confié à quelqu'un d'autre en route devient visible. */}
            <Field label="Chauffeur (déclaré au départ)" required>
              <Input list="chauffeurs-connus" value={form.nomChauffeur} onChange={(e) => set('nomChauffeur', e.target.value)} required placeholder="Nom et prénom" />
              <datalist id="chauffeurs-connus">
                {chauffeurs.map((c) => <option key={c.id} value={c.nom} />)}
              </datalist>
            </Field>
            {isManager && (
              <Field label="Transporteur">
                <Select value={form.transporteurId} onChange={(e) => set('transporteurId', e.target.value)} placeholder="—"
                  options={transporteurs.map((t) => ({ value: t.id, label: t.nom }))} />
              </Field>
            )}
          </div>

          {/* Le PDF du BL est déjà joint par la zone de pré-remplissage ci-dessus
              (analysé ou simplement archivé) : plus de champ « PDF du bon de
              livraison » séparé, qui écrivait le même blPdfPath. Reste le
              bordereau de chargement, qui est un AUTRE document. */}
          {/* Bordereau OBLIGATOIRE : c'est la preuve de ce qui est sorti du dépôt.
              L'API le refuse sans, on le signale donc avant l'envoi. */}
          <Field label="PDF du bordereau de chargement" required>
            <div className="flex items-center gap-2 text-xs">
              <input type="file" accept="application/pdf" onChange={(e) => { const f = e.target.files?.[0]; if (f) doUpload(f, 'bordereau'); }} />
              {uploading === 'bordereau' && <span className="text-gray-400">Envoi…</span>}
              {bordereauPdfPath && uploading !== 'bordereau' && <span className="text-green-600">✓ joint</span>}
              {!bordereauPdfPath && uploading !== 'bordereau' && <span className="text-amber-600">requis</span>}
            </div>
          </Field>

          <Field label="Observations"><Textarea value={form.observations} onChange={(e) => set('observations', e.target.value)} rows={2} /></Field>
          {warnings.length === 0 && (
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={onClose}>Annuler</Button>
              <Button type="submit" loading={mutation.isPending}
                disabled={!!uploading || analysing || !blPdfPath || !bordereauPdfPath}>Créer</Button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

const BC_COLORS: Record<string, string> = { OUVERT: 'bg-green-100 text-green-700', CLOTURE: 'bg-gray-200 text-gray-700', ANNULE: 'bg-red-100 text-red-700' };

export default function BonCommandeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const isManager = ['MANAGER', 'ADMIN'].includes((session?.user as { role?: string })?.role ?? '');
  const [showModal, setShowModal] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['bon-commande', id],
    queryFn: () => api.get(`/bons-commande/${id}`).then((r) => r.data.data as BC),
  });

  // Le statut du BC est désormais opposable (plus de BL ni de modification de
  // volume sur un trimestre clôturé) : il lui fallait donc un vrai geste.
  const statutMut = useMutation({
    mutationFn: (statut: string) => api.put(`/bons-commande/${id}`, { statut }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bon-commande', id] }),
  });

  if (isLoading) return <Loading />;
  if (isError || !data) return <div className="p-6"><ErrorState /></div>;

  const totalPrevu = data.suivi.reduce((s, v) => s + v.prevu, 0);
  const totalCharge = data.suivi.reduce((s, v) => s + v.charge, 0);
  const totalLivre = data.suivi.reduce((s, v) => s + v.livre, 0);

  return (
    <div>
      <PageHeader
        title={`Bon de commande ${data.numero}`}
        subtitle={`T${data.trimestre} ${data.annee}${data.numeroClient ? ` · Client ${data.numeroClient}` : ''}`}
        backHref="/carburant/commandes"
        actions={
          <div className="flex items-center gap-2">
            <Badge className={BC_COLORS[data.statut] || ''}>{L_STATUT_BC[data.statut] ?? data.statut}</Badge>
            <Button variant="secondary" icon={Scale} onClick={() => router.push(`/carburant/commandes/${id}/rapprochement`)}>Rapprochement</Button>
            {isManager && data.statut !== 'ANNULE' && (
              <Button variant="secondary" loading={statutMut.isPending}
                onClick={() => statutMut.mutate(data.statut === 'OUVERT' ? 'CLOTURE' : 'OUVERT')}>
                {data.statut === 'OUVERT' ? 'Clôturer' : 'Rouvrir'}
              </Button>
            )}
            {data.statut === 'OUVERT' && <Button icon={Plus} onClick={() => setShowModal(true)}>Nouveau bon de livraison</Button>}
          </div>
        }
      />

      {data.statut !== 'OUVERT' && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
          Commande {data.statut.toLowerCase()} : plus aucun chargement ne peut y être ajouté, et les volumes de ses bons de livraison sont figés.
        </div>
      )}

      {data.bcPdfPath && (
        <a href={data.bcPdfUrl ?? undefined} target="_blank" rel="noopener noreferrer"
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
              <th className="text-right">Commandé (L)</th>
              <th className="text-right">Chargé (L)</th>
              <th className="text-right">Livré sur sites (L)</th>
              <th className="text-right">En cours</th>
              <th className="text-right">Écart / commande</th>
            </tr>
          </thead>
          <tbody>
            {data.suivi.map((v) => (
              <tr key={v.mois} className="border-b last:border-0">
                <td className="py-2">{MOIS[v.mois]}</td>
                <td className="text-right">{fmtNumber(v.prevu)}</td>
                <td className="text-right">{fmtNumber(v.charge)}</td>
                <td className="text-right">{fmtNumber(v.livre)}</td>
                <td className={`text-right ${v.enCours > TOL ? 'text-amber-600' : 'text-gray-400'}`}>
                  {v.enCours > TOL ? fmtNumber(v.enCours) : '—'}
                </td>
                <td className={`text-right font-medium ${v.depassement ? 'text-red-600' : v.ecart < -TOL ? 'text-amber-600' : 'text-green-600'}`}>
                  {v.ecart > 0 ? '+' : ''}{fmtNumber(v.ecart)}
                </td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="py-2">Total</td>
              <td className="text-right">{fmtNumber(totalPrevu)}</td>
              <td className="text-right">{fmtNumber(totalCharge)}</td>
              <td className="text-right">{fmtNumber(totalLivre)}</td>
              <td className={`text-right ${totalCharge - totalLivre > TOL ? 'text-amber-600' : 'text-gray-400'}`}>
                {totalCharge - totalLivre > TOL ? fmtNumber(totalCharge - totalLivre) : '—'}
              </td>
              <td className={`text-right ${totalCharge > totalPrevu + TOL ? 'text-red-600' : 'text-gray-700'}`}>{totalCharge - totalPrevu > 0 ? '+' : ''}{fmtNumber(totalCharge - totalPrevu)}</td>
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
                  <td className="py-2 font-medium text-gray-800">{bl.numeroBL}{bl.isBrouillon && <Badge className="bg-amber-100 text-amber-700 ml-1.5">brouillon</Badge>}</td>
                  <td>{MOIS[bl.mois]}</td>
                  <td>{bl.immatriculation}</td>
                  <td className="text-right">{fmtNumber(Number(bl.volumeChargeLitres))}</td>
                  <td className="text-center">{bl._count?.lignes ?? 0}</td>
                  <td>{fmtDate(bl.dateChargement)}</td>
                  <td><Badge className={BL_COLORS[bl.statut] || ''}>{L_STATUT_BL[bl.statut] ?? bl.statut}</Badge></td>
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
