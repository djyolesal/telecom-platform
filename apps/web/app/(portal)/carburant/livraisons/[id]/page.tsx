'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, AlertTriangle, Plus, X, Trash2, Download, FileText, Pencil, Navigation } from 'lucide-react';
import { api } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { PageHeader } from '@/components/shared/PageHeader';
import { Loading, ErrorState } from '@/components/shared/states';
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
  site: { code: string; nom: string; region: string; latitude?: number | null; longitude?: number | null };
  depotages: { id: string; dateDepotage: string; volumeLitres: number }[];
}
interface BL {
  id: string; numeroBL: string; mois: number; annee: number; immatriculation: string; numeroClient: string | null;
  volumeChargeLitres: number; dateChargement: string; dateTraitement?: string; statut: string; observations?: string; isBrouillon?: boolean;
  blPdfPath?: string; bordereauPdfPath?: string;
  /** URLs signées fournies par l'API (le bucket n'est plus lisible par son chemin). */
  blPdfUrl?: string | null; bordereauPdfUrl?: string | null;
  bonCommande?: { numero: string; annee: number; trimestre: number };
  transporteur?: { id: string; nom: string };
  chauffeur?: { id: string; nom: string } | null;
  vehicule?: { id: string; libelle: string; capaciteCiterneLitres?: number | null } | null;
  lignes: Ligne[]; sommeLignes: number; coherenceCharge: boolean;
  // Clôture comptable : ventilation du reste en citerne.
  dateCloture?: string | null; estClos?: boolean;
  resteRetourDepotLitres?: number | null; restePerteLitres?: number | null; resteReportLitres?: number | null;
  reportSurBlId?: string | null; motifCloture?: string | null;
  bonRetourPath?: string | null; bonRetourUrl?: string | null;
  reste?: number; resteVentile?: number; resteAExpliquer?: number;
  // Reports REÇUS d'autres chargements : ces litres sont dans cette citerne.
  reportsRecus?: { id: string; numeroBL: string; resteReportLitres: number }[];
  reportSurBl?: { id: string; numeroBL: string } | null;
  reportRecu?: number; volumeDisponible?: number;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex justify-between py-1.5 text-sm border-b last:border-0"><span className="text-gray-500">{label}</span><span className="font-medium text-gray-800">{value}</span></div>;
}

interface LigneEdit { siteId: string; volume: string }

// Upload d'une pièce jointe (bon de retour) → renvoie la clé de stockage.
async function uploadPdfBl(file: File): Promise<string> {
  const fd = new FormData();
  fd.append('folder', 'documents');
  fd.append('file', file);
  const r = await api.post('/upload/document', fd);
  return r.data?.data?.key as string;
}

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
                      options={sites.map((s) => ({ value: s.id, label: s.nom }))} />
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

interface Transporteur { id: string; nom: string }
const todayStr = () => new Date().toISOString().slice(0, 10);

// Édition de l'entête du BL (manager) — sert à finaliser un brouillon.
function EditHeaderModal({ bl, onClose }: { bl: BL; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    numeroBL: bl.numeroBL.startsWith('BR-') ? '' : bl.numeroBL,
    immatriculation: bl.immatriculation === 'À AFFECTER' ? '' : bl.immatriculation,
    volumeChargeLitres: String(Math.round(Number(bl.volumeChargeLitres))),
    // Brouillon (réappro prédictif) : la date de chargement stockée est fabriquée
    // (date de planification). On la laisse VIDE pour forcer la saisie de la
    // date réelle du camion à la finalisation ; sinon on garde la date existante.
    dateChargement: bl.numeroBL.startsWith('BR-') ? '' : (bl.dateChargement ? bl.dateChargement.slice(0, 10) : ''),
    transporteurId: bl.transporteur?.id ?? '',
    nomChauffeur: bl.chauffeur?.nom ?? '',
    statut: bl.statut,
  });
  const [error, setError] = useState('');
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const { data: transporteurs = [] } = useQuery({
    queryKey: ['transporteurs'],
    queryFn: () => api.get('/prestataires', { params: { is_transporteur: true, is_active: true, limit: 100 } }).then((r) => r.data.data as Transporteur[]),
  });
  const { data: chauffeurs = [] } = useQuery({
    queryKey: ['chauffeurs-options'],
    queryFn: () => api.get('/chauffeurs', { params: { actifs: true, limit: 200 } }).then((r) => r.data.data as { id: string; nom: string }[]),
  });

  const mutation = useMutation({
    mutationFn: () => api.put(`/bons-livraison/${bl.id}`, {
      numeroBL: form.numeroBL, immatriculation: form.immatriculation,
      volumeChargeLitres: Number(form.volumeChargeLitres) || 0,
      dateChargement: form.dateChargement,
      transporteurId: form.transporteurId || null,
      nomChauffeur: form.nomChauffeur || undefined,
      statut: form.statut,
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['bon-livraison', bl.id] }); onClose(); },
    onError: (e: { response?: { data?: { error?: string } } }) => setError(e.response?.data?.error || 'Erreur'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-800">Entête du bon de livraison</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={18} /></button>
        </div>
        {error && <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>}
        <form onSubmit={(e) => { e.preventDefault(); setError(''); mutation.mutate(); }} className="grid grid-cols-2 gap-3">
          <Field label="N° bon de livraison" required><Input value={form.numeroBL} onChange={(e) => set('numeroBL', e.target.value)} required placeholder="BL-00123" /></Field>
          <Field label="Immatriculation" required><Input value={form.immatriculation} onChange={(e) => set('immatriculation', e.target.value)} required placeholder="TG-1234-AB" /></Field>
          <Field label="Volume chargé (L)" required><Input type="number" value={form.volumeChargeLitres} onChange={(e) => set('volumeChargeLitres', e.target.value)} required /></Field>
          <Field label="Date chargement" required><Input type="date" max={todayStr()} value={form.dateChargement} onChange={(e) => set('dateChargement', e.target.value)} required /></Field>
          <Field label="Transporteur"><Select value={form.transporteurId} onChange={(e) => set('transporteurId', e.target.value)} placeholder="—" options={transporteurs.map((tr) => ({ value: tr.id, label: tr.nom }))} /></Field>
          <Field label="Chauffeur (déclaré au départ)">
            <Input list="chauffeurs-connus-bl" value={form.nomChauffeur} onChange={(e) => set('nomChauffeur', e.target.value)} placeholder="Nom et prénom" />
            <datalist id="chauffeurs-connus-bl">{chauffeurs.map((c) => <option key={c.id} value={c.nom} />)}</datalist>
          </Field>
          <Field label="Statut"><Select value={form.statut} onChange={(e) => set('statut', e.target.value)} options={['PLANIFIE', 'CHARGE', 'LIVRE', 'ANNULE'].map((s) => ({ value: s, label: s }))} /></Field>
          <div className="col-span-2 flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>Annuler</Button>
            <Button type="submit" loading={mutation.isPending}>Enregistrer</Button>
          </div>
        </form>
      </div>
    </div>
  );
}


/**
 * Une ligne du plan. Deux apports pour le transporteur :
 *  — « Itinéraire » : le chauffeur doit trouver le site (coordonnées du site).
 *  — le détail des dépotages RÉELS (date + volume) : l'API les envoyait déjà
 *    mais l'écran n'affichait qu'un total ; c'est pourtant la preuve de ce qui
 *    a été réceptionné, et ce sur quoi porte tout litige.
 */
function LignePlan({ ligne: l }: { ligne: Ligne }) {
  const [ouvert, setOuvert] = useState(false);
  const aCoord = l.site.latitude != null && l.site.longitude != null;
  const nbDepotages = l.depotages?.length ?? 0;

  return (
    <>
      <tr className="border-b last:border-0">
        <td className="py-2">
          <span className="font-medium text-gray-800">{l.site.nom}</span>
          <span className="ml-1.5 text-xs text-gray-400">{l.site.code}</span>
          {aCoord && (
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${l.site.latitude},${l.site.longitude}`}
              target="_blank" rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              title="Ouvrir l'itinéraire vers ce site"
              className="ml-2 inline-flex items-center gap-1 rounded border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-600 hover:bg-gray-50"
            >
              <Navigation size={11} /> Itinéraire
            </a>
          )}
        </td>
        <td className="text-gray-600">{l.site.region}</td>
        <td className="text-right">{fmtNumber(Number(l.volumePrevuLitres))}</td>
        <td className="text-right">
          {l.volumeLivreReel > 0 ? fmtNumber(l.volumeLivreReel) : '—'}
          {nbDepotages > 0 && (
            <button type="button" onClick={() => setOuvert((o) => !o)}
              className="ml-1.5 text-[11px] text-blue-600 hover:underline">
              {ouvert ? 'masquer' : `${nbDepotages} dépotage${nbDepotages > 1 ? 's' : ''}`}
            </button>
          )}
        </td>
        <td className={`text-right font-medium ${Math.abs(l.ecart) <= 0.5 ? 'text-gray-400' : l.ecart > 0 ? 'text-blue-600' : 'text-amber-600'}`}>
          {l.volumeLivreReel > 0 ? `${l.ecart > 0 ? '+' : ''}${fmtNumber(l.ecart)}` : '—'}
        </td>
        <td><Badge className={LIGNE_COLORS[l.statut] || ''}>{l.statut}</Badge></td>
      </tr>
      {ouvert && nbDepotages > 0 && (
        <tr className="bg-gray-50/60">
          <td colSpan={6} className="px-3 py-2">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Réceptions sur ce site</p>
            <ul className="space-y-0.5">
              {l.depotages.map((d) => (
                <li key={d.id} className="flex justify-between text-xs text-gray-700">
                  <span>{fmtDate(d.dateDepotage)}</span>
                  <span className="tabular-nums font-medium">{fmtNumber(Number(d.volumeLitres))} L</span>
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Clôture d'un chargement : le geste qui SOLDE un camion. Tant que le reste en
 * citerne n'est pas ventilé (retour dépôt / perte / report), il reste un
 * manquant camion perpétuel — et rien ne distingue un retour honnête d'un
 * siphonnage. La somme des trois destinations doit égaler le reste.
 */
function ClotureModal({ bl, reste, onClose }: { bl: BL; reste: number; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [retour, setRetour] = useState('');
  const [perte, setPerte] = useState('');
  const [report, setReport] = useState('');
  const [reportSurBlId, setReportSurBlId] = useState('');
  const [motif, setMotif] = useState('');
  const [bonRetourPath, setBonRetourPath] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const num = (v: string) => (v.trim() === '' ? 0 : Number(v.replace(',', '.')) || 0);
  const somme = num(retour) + num(perte) + num(report);
  const equilibre = Math.abs(somme - reste) <= TOL;

  // Cibles de report : chargements ouverts (ni brouillon, ni annulés, ni clos).
  const { data: cibles = [] } = useQuery({
    queryKey: ['bls-report', bl.id],
    queryFn: () => api.get('/bons-livraison', { params: { limit: 50 } })
      .then((r) => (r.data.data as BL[]).filter((x) => x.id !== bl.id && !x.isBrouillon && x.statut !== 'ANNULE' && !x.dateCloture)),
    enabled: num(report) > TOL,
  });

  const mutation = useMutation({
    mutationFn: () => api.post(`/bons-livraison/${bl.id}/cloturer`, {
      resteRetourDepotLitres: num(retour),
      restePerteLitres: num(perte),
      resteReportLitres: num(report),
      reportSurBlId: num(report) > TOL ? reportSurBlId : undefined,
      motifCloture: motif || undefined,
      bonRetourPath: bonRetourPath || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bon-livraison', bl.id] });
      onClose();
    },
    onError: (e: { response?: { data?: { error?: string } } }) => setError(e.response?.data?.error ?? 'Clôture impossible'),
  });

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setUploading(true);
    try { setBonRetourPath(await uploadPdfBl(f)); }
    catch { setError('Envoi du bon de retour impossible'); }
    finally { setUploading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-800">Clôturer le chargement {bl.numeroBL}</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-gray-100"><X size={18} /></button>
        </div>
        <p className="mb-4 text-xs text-gray-500">
          Reste en citerne à expliquer : <strong className="text-gray-800">{fmtNumber(reste)} L</strong>
          {' '}({fmtNumber(Number(bl.volumeChargeLitres))} L chargés − {fmtNumber(Number(bl.volumeChargeLitres) - reste)} L livrés).
        </p>

        <form onSubmit={(e) => { e.preventDefault(); setError(''); mutation.mutate(); }} className="space-y-3">
          <Field label="Retour au dépôt (L)">
            <Input type="number" value={retour} onChange={(e) => setRetour(e.target.value)} placeholder="0" />
          </Field>
          {num(retour) > TOL && (
            <div>
              <label className="mb-1 block text-xs text-gray-600">Bon de retour signé du dépôt *</label>
              <input type="file" accept="application/pdf,image/*" onChange={(e) => onFile(e.target.files?.[0])}
                className="block w-full text-xs text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-1.5" />
              {uploading && <p className="mt-1 text-xs text-gray-500">Envoi…</p>}
              {bonRetourPath && <p className="mt-1 text-xs text-green-700">Pièce jointe enregistrée.</p>}
            </div>
          )}
          <Field label="Perte constatée (L)">
            <Input type="number" value={perte} onChange={(e) => setPerte(e.target.value)} placeholder="0" />
          </Field>
          <Field label="Report sur un autre chargement (L)">
            <Input type="number" value={report} onChange={(e) => setReport(e.target.value)} placeholder="0" />
          </Field>
          {num(report) > TOL && (
            <Field label="Chargement qui reprend ce reste *">
              <Select value={reportSurBlId} onChange={(e) => setReportSurBlId(e.target.value)} placeholder="Choisir un chargement"
                options={cibles.map((c) => ({ value: c.id, label: `${c.numeroBL} · ${c.immatriculation}` }))} />
            </Field>
          )}
          <Field label={num(perte) > TOL ? 'Motif (obligatoire pour une perte) *' : 'Motif / observations'}>
            <Input value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="Ex. fuite constatée au dépotage du site X" />
          </Field>

          <div className={`rounded-lg px-3 py-2 text-sm ${equilibre ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`}>
            Ventilé : {fmtNumber(somme)} L / {fmtNumber(reste)} L
            {!equilibre && ` — écart de ${fmtNumber(Math.abs(somme - reste))} L`}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={onClose}>Annuler</Button>
            <Button type="submit" loading={mutation.isPending} disabled={!equilibre || uploading}>Clôturer</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function BonLivraisonDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role ?? '';
  const isManager = role === 'MANAGER' || role === 'ADMIN';
  const [showPlan, setShowPlan] = useState(false);
  const [showHeader, setShowHeader] = useState(false);
  const [showCloture, setShowCloture] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['bon-livraison', id],
    queryFn: () => api.get(`/bons-livraison/${id}`).then((r) => r.data.data as BL),
  });

  // Annulation d'un BROUILLON : il n'existait aucune action pour écarter une
  // proposition du réappro prédictif. Réservée aux brouillons — l'API refuse la
  // suppression d'un BL réel (hors admin) et de tout BL portant des dépotages.
  const supprimerBrouillon = useMutation({
    mutationFn: () => api.delete(`/bons-livraison/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bons-livraison'] });
      router.push('/carburant/livraisons');
    },
    onError: (e: { response?: { data?: { error?: string } } }) =>
      window.alert(e.response?.data?.error ?? 'Suppression impossible'),
  });

  if (isLoading) return <Loading />;
  if (isError || !data) return <div className="p-6"><ErrorState /></div>;

  const totalLivreReel = data.lignes.reduce((s, l) => s + l.volumeLivreReel, 0);
  // Ce qui n'est pas encore descendu du camion (jamais négatif : une
  // sur-livraison ne se lit pas comme un reste).
  // Volume réellement embarqué = chargé au dépôt + reports reçus. Sans les
  // compter, ce camion livrait plus qu'il n'avait « chargé » et ressortait en
  // sur-livraison pour avoir fait ce qui était prévu.
  const reportRecu = data.reportRecu ?? 0;
  const volumeDisponible = Number(data.volumeChargeLitres) + reportRecu;
  const resteCiterne = Math.max(0, volumeDisponible - totalLivreReel);
  const hasPlan = data.lignes.length > 0;
  const clos = !!data.dateCloture;
  // Clôturable : un chargement réel, non annulé, pas déjà soldé.
  const peutCloturer = isManager && !clos && !data.isBrouillon && data.statut !== 'ANNULE';

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
            {isManager && <Button variant="secondary" icon={Pencil} onClick={() => setShowHeader(true)}>Entête</Button>}
            {isManager && <Button icon={hasPlan ? Pencil : Plus} onClick={() => setShowPlan(true)}>{hasPlan ? 'Éditer le plan' : 'Générer le plan'}</Button>}
            {peutCloturer && (
              <Button variant="secondary" icon={CheckCircle2} onClick={() => setShowCloture(true)}>Clôturer</Button>
            )}
            {isManager && data.isBrouillon && (
              <Button variant="secondary" icon={Trash2} loading={supprimerBrouillon.isPending}
                onClick={() => {
                  if (window.confirm(`Annuler le brouillon ${data.numeroBL} ? Il sera supprimé du plan d'approvisionnement.`)) {
                    supprimerBrouillon.mutate();
                  }
                }}>
                Annuler le brouillon
              </Button>
            )}
          </div>
        }
      />

      {clos && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          Chargement clôturé le {fmtDate(data.dateCloture!)} — le reste en citerne a été ventilé, ce camion ne compte plus dans les écarts.
          {data.motifCloture ? ` Motif : ${data.motifCloture}` : ''}
        </div>
      )}

      {data.numeroBL.startsWith('BR-') && (
        <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
          Brouillon généré par le réapprovisionnement prédictif — finalisez l’entête (N° BL réel, camion, transporteur) puis ajustez le plan si besoin.
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h3 className="font-semibold text-gray-700 text-sm mb-2">Détails du chargement</h3>
          <Row label="N° client" value={data.numeroClient ?? '—'} />
          <Row label="Transporteur" value={data.transporteur?.nom ?? '—'} />
          <Row label="Camion" value={data.immatriculation} />
          {/* Le chauffeur déclaré est la référence du contrôle terrain : sans lui,
              la signature manuscrite exigée au dépotage ne valait rien en litige. */}
          <Row label="Chauffeur déclaré" value={data.chauffeur?.nom ?? <span className="text-amber-600">non déclaré</span>} />
          {data.vehicule?.capaciteCiterneLitres != null && (
            <Row label="Capacité citerne" value={`${fmtNumber(Number(data.vehicule.capaciteCiterneLitres))} L`} />
          )}
          <Row label="Volume chargé" value={`${fmtNumber(Number(data.volumeChargeLitres))} L`} />
          <Row label="Date chargement" value={fmtDate(data.dateChargement)} />
          {data.dateTraitement && <Row label="Date traitement" value={fmtDate(data.dateTraitement)} />}
          {(data.blPdfPath || data.bordereauPdfPath) && (
            <div className="flex gap-2 pt-3">
              {data.blPdfPath && <a href={data.blPdfUrl ?? undefined} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50"><FileText size={13} className="text-red-500" /> PDF du BL</a>}
              {data.bordereauPdfPath && <a href={data.bordereauPdfUrl ?? undefined} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50"><FileText size={13} className="text-red-500" /> Bordereau</a>}
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
          {reportRecu > 0 && (
            <Row
              label="Reste reçu d'un autre chargement"
              value={
                <span className="text-blue-700">
                  +{fmtNumber(reportRecu)} L
                  {data.reportsRecus?.length ? ` (${data.reportsRecus.map((r) => r.numeroBL).join(', ')})` : ''}
                </span>
              }
            />
          )}
          <Row label="Total livré (réel)" value={`${fmtNumber(totalLivreReel)} L`} />
          {/* Ce qui reste dans la citerne : c'est l'écart camion sur lequel le
              pilotage interpelle le transporteur — il doit le voir en premier. */}
          <Row label="Reste à livrer (citerne)"
            value={<span className={resteCiterne > 0.5 ? 'text-amber-700 font-semibold' : 'text-green-700 font-semibold'}>
              {fmtNumber(resteCiterne)} L
            </span>} />
          {/* Ventilation du reste : la preuve que le camion est soldé. */}
          {clos && (
            <div className="mt-2 border-t pt-2">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Reste ventilé à la clôture</p>
              {Number(data.resteRetourDepotLitres) > 0 && <Row label="Retour au dépôt" value={`${fmtNumber(Number(data.resteRetourDepotLitres))} L`} />}
              {Number(data.restePerteLitres) > 0 && <Row label="Perte constatée" value={`${fmtNumber(Number(data.restePerteLitres))} L`} />}
              {Number(data.resteReportLitres) > 0 && (
                <Row label="Reporté sur un autre chargement"
                  value={`${fmtNumber(Number(data.resteReportLitres))} L${data.reportSurBl ? ` → ${data.reportSurBl.numeroBL}` : ''}`} />
              )}
              {data.bonRetourUrl && (
                <a href={data.bonRetourUrl} target="_blank" rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
                  <FileText size={13} className="text-red-500" /> Bon de retour
                </a>
              )}
            </div>
          )}
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
                <LignePlan key={l.id} ligne={l} />
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
      {showHeader && <EditHeaderModal bl={data} onClose={() => setShowHeader(false)} />}
      {showCloture && <ClotureModal bl={data} reste={resteCiterne} onClose={() => setShowCloture(false)} />}
    </div>
  );
}
