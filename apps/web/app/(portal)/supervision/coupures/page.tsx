'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Upload, X, CheckCircle2, AlertTriangle, WifiOff } from 'lucide-react';
import { api } from '@/lib/api';
import { ExportButtons } from '@/components/shared/ExportButtons';
import { PageHeader } from '@/components/shared/PageHeader';
import { FilterBar } from '@/components/shared/FilterBar';
import { DataTable, Column } from '@/components/shared/DataTable';
import { Pagination, PaginationMeta } from '@/components/shared/Pagination';
import { TableSkeleton, EmptyState, ErrorState } from '@/components/shared/states';
import { Button } from '@/components/shared/Button';
import { Field, Input, Select, Textarea } from '@/components/shared/Form';
import { SearchSelect } from '@/components/shared/SearchSelect';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { fmtDateTime } from '@/lib/utils';

interface Coupure {
  id: string;
  technologie: string;
  frequence?: string | null;
  secteur?: string | null;
  dateDebut: string;
  dateFin?: string | null;
  downtimeMinutes?: number | null;
  cause?: string | null;
  actions?: string | null;
  typeAlarme?: string | null;
  technicienContacte?: string | null;
  intervenants?: string | null;
  observations?: string | null;
  origine?: string;
  coupureOrigine?: { id: string; site?: { nom: string } } | null;
  incident?: { id: string; reference?: string | null; statut: string } | null;
  causeCategorie?: string | null;
  _count?: { heritees: number };
  site?: { nom: string; region: string };
}

const TECHNOS = [
  { value: 'SITE', label: 'Site entier' },
  { value: '2G', label: '2G' }, { value: '3G', label: '3G' },
  { value: '4G', label: '4G' }, { value: '5G', label: '5G' },
];
// Référentiel NOC (INNER du rapport de supervision).
const TYPES_ALARME = ['AE', 'GE', 'EN', 'FO', 'TX', 'RA', 'MI', 'MD', 'NA'].map((v) => ({ value: v, label: v }));

const fmtDowntime = (min?: number | null) => {
  if (min == null) return '—';
  if (min < 60) return `${min} min`;
  if (min < 60 * 48) return `${Math.floor(min / 60)} h ${min % 60 ? (min % 60) + ' min' : ''}`.trim();
  return `${Math.floor(min / 1440)} j ${Math.floor((min % 1440) / 60)} h`;
};

const TechnoBadge = ({ t }: { t: string }) => (
  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${t === 'SITE' ? 'bg-red-50 text-red-700' : 'bg-[#EAF1F8] text-[#1B3F6B]'}`}>
    {t === 'SITE' ? 'Site entier' : t}
  </span>
);

export default function CoupuresReseauPage() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role;
  // Écriture réservée au NOC/manager/admin — les techniciens passent par les
  // incidents, les superviseurs et prestataires consultent.
  const peutEcrire = ['NOC', 'MANAGER', 'ADMIN'].includes(role ?? '');
  const peutImporter = ['NOC', 'MANAGER', 'ADMIN'].includes(role ?? '');

  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statut, setStatut] = useState('');
  const [technologie, setTechnologie] = useState('');
  const [typeAlarme, setTypeAlarme] = useState('');
  const [du, setDu] = useState('');
  const [au, setAu] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [edition, setEdition] = useState<Coupure | null>(null);
  const debounced = useDebounce(search);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['coupures', { page, debounced, statut, technologie, typeAlarme, du, au }],
    queryFn: () => api.get('/coupures-reseau', {
      params: {
        page, limit: 20,
        search: debounced || undefined, statut: statut || undefined,
        technologie: technologie || undefined, type_alarme: typeAlarme || undefined,
        date_debut: du || undefined, date_fin: au || undefined,
      },
    }).then((r) => r.data),
  });

  // Export xlsx/PDF avec EXACTEMENT les filtres affichés (période comprise).
  const exportQuery = [
    debounced && `search=${encodeURIComponent(debounced)}`,
    statut && `statut=${statut}`,
    technologie && `technologie=${technologie}`,
    typeAlarme && `type_alarme=${typeAlarme}`,
    du && `date_debut=${du}`,
    au && `date_fin=${au}`,
  ].filter(Boolean).join('&');
  const rows: Coupure[] = data?.data ?? [];
  const meta: PaginationMeta | undefined = data?.meta;

  const columns: Column<Coupure>[] = [
    {
      key: 'site', header: 'Site', sortValue: (c) => c.site?.nom,
      render: (c) => (
        <span className="font-medium text-gray-800">
          {c.site?.nom ?? '—'}
          {c.origine === 'HERITEE' && (
            <span className="ml-1.5 rounded-full bg-purple-50 px-1.5 py-0.5 text-[10px] font-bold text-purple-700" title={`Impact hérité de ${c.coupureOrigine?.site?.nom ?? 'un site amont'}`}>
              ← {c.coupureOrigine?.site?.nom ?? 'amont'}
            </span>
          )}
          {(c._count?.heritees ?? 0) > 0 && (
            <span className="ml-1.5 rounded-full bg-[#EAF1F8] px-1.5 py-0.5 text-[10px] font-bold text-[#1B3F6B]" title="Coupure racine : sites impactés en aval">
              {c._count!.heritees} impacté(s)
            </span>
          )}
        </span>
      ),
    },
    { key: 'technologie', header: 'Technologie', render: (c) => <TechnoBadge t={c.technologie} /> },
    { key: 'dateDebut', header: 'Début', render: (c) => fmtDateTime(c.dateDebut) },
    {
      key: 'dateFin', header: 'Fin',
      render: (c) => c.dateFin ? fmtDateTime(c.dateFin) : <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-700">EN COURS</span>,
    },
    { key: 'downtimeMinutes', header: 'Downtime', align: 'right', render: (c) => fmtDowntime(c.downtimeMinutes) },
    { key: 'typeAlarme', header: 'Alarme', align: 'center', render: (c) => c.typeAlarme ?? '—' },
    { key: 'cause', header: 'Cause', render: (c) => <span className="text-gray-600">{c.cause ?? '—'}</span> },
  ];

  return (
    <div>
      <PageHeader
        title="Coupures réseau"
        subtitle="Indisponibilités radio (supervision NOC) : saisie, suivi et import du rapport"
        actions={
          <>
            {peutImporter && (
              <button type="button" onClick={() => setShowImport(true)}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                <Upload size={15} /> Importer le rapport
              </button>
            )}
            {peutEcrire && <Button icon={Plus} onClick={() => setShowCreate(true)}>Nouvelle coupure</Button>}
            <ExportButtons base="/coupures-reseau/export" name="coupures-reseau" query={exportQuery || undefined} />
          </>
        }
      />

      <FilterBar
        search={search}
        onSearch={(v) => { setSearch(v); setPage(1); }}
        searchPlaceholder="Rechercher un site…"
        filters={[
          { key: 'statut', label: 'Tous statuts', value: statut, options: [{ value: 'EN_COURS', label: 'En cours' }, { value: 'TERMINEE', label: 'Rétablies' }], onChange: (v) => { setStatut(v); setPage(1); } },
          { key: 'techno', label: 'Toutes technologies', value: technologie, options: TECHNOS, onChange: (v) => { setTechnologie(v); setPage(1); } },
          { key: 'alarme', label: 'Toutes alarmes', value: typeAlarme, options: TYPES_ALARME, onChange: (v) => { setTypeAlarme(v); setPage(1); } },
        ]}
      />

      {/* Période (début de coupure) : borne les données affichées ET les exports. */}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-gray-500">Période :</span>
        <input type="date" value={du} onChange={(e) => { setDu(e.target.value); setPage(1); }}
          className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700 outline-none focus:border-[#2471A3]" />
        <span className="text-gray-400">→</span>
        <input type="date" value={au} onChange={(e) => { setAu(e.target.value); setPage(1); }}
          className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700 outline-none focus:border-[#2471A3]" />
        {(du || au) && (
          <button type="button" onClick={() => { setDu(''); setAu(''); setPage(1); }}
            className="text-xs font-medium text-[#2471A3] hover:underline">Effacer</button>
        )}
      </div>

      {isLoading ? <TableSkeleton cols={7} />
        : isError ? <ErrorState />
        : rows.length === 0 ? <EmptyState title="Aucune coupure" hint="Saisissez une coupure ou importez le rapport de supervision." />
        : (
          <>
            <DataTable columns={columns} data={rows} maxHeight="65vh" onRowClick={peutEcrire ? (c) => setEdition(c) : undefined} />
            <Pagination meta={meta} onChange={setPage} />
          </>
        )}

      {showCreate && <CoupureFormModal onClose={() => setShowCreate(false)} onDone={() => queryClient.invalidateQueries({ queryKey: ['coupures'] })} />}
      {edition && <CoupureEditModal coupure={edition} onClose={() => setEdition(null)} onDone={() => queryClient.invalidateQueries({ queryKey: ['coupures'] })} />}
      {showImport && <ImportModal onClose={() => setShowImport(false)} onDone={() => queryClient.invalidateQueries({ queryKey: ['coupures'] })} />}
    </div>
  );
}

// ── Création ────────────────────────────────────────────────────────────────

function CoupureFormModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { data: sites } = useQuery({
    queryKey: ['sites-all'],
    queryFn: () => api.get('/sites', { params: { all: 'true' } }).then((r) => r.data.data as { id: string; nom: string }[]),
    staleTime: 5 * 60_000,
  });
  const [siteId, setSiteId] = useState('');
  const [technos, setTechnos] = useState<Set<string>>(new Set(['SITE']));
  const [dateDebut, setDateDebut] = useState('');
  const [typeAlarme, setTypeAlarme] = useState('');
  const [cause, setCause] = useState('');
  const [technicien, setTechnicien] = useState('');
  const [observations, setObservations] = useState('');
  const [propagerAval, setPropagerAval] = useState(true);

  const { data: transmission } = useQuery({
    queryKey: ['site-transmission', siteId],
    queryFn: () => api.get(`/sites/${siteId}/transmission`).then((r) => r.data.data as { aval: { id: string; nom: string }[] }),
    enabled: !!siteId,
  });
  const nbAval = transmission?.aval.length ?? 0;
  // La propagation à l'aval n'a de sens que si le SITE ENTIER est tombé
  // (perte d'énergie → perte du lien de transmission). Une coupure partielle
  // (une techno down, site alimenté) laisse la transmission en service :
  // l'aval n'est pas menacé, on ne doit pas pouvoir lui créer des héritées.
  const siteEntier = technos.has('SITE') || ['2G', '3G', '4G', '5G'].every((t) => technos.has(t));

  const mutation = useMutation({
    mutationFn: () => api.post('/coupures-reseau', {
      siteId,
      technologies: [...technos],
      propagerAval: siteEntier && nbAval > 0 && propagerAval,
      dateDebut,
      typeAlarme: typeAlarme || undefined,
      cause: cause || undefined,
      technicienContacte: technicien || undefined,
      observations: observations || undefined,
    }),
    onSuccess: () => { onDone(); onClose(); },
  });

  const toggleTechno = (v: string) => {
    const next = new Set(v === 'SITE' ? [] : [...technos].filter((t) => t !== 'SITE'));
    if (technos.has(v)) next.delete(v); else next.add(v);
    if (next.size === 0) next.add('SITE');
    setTechnos(next.has('SITE') ? new Set(['SITE']) : next);
  };

  const errMsg = (mutation.error as { response?: { data?: { error?: string } } } | null)?.response?.data?.error;

  return (
    <Modal titre="Nouvelle coupure réseau" onClose={onClose}>
      <Field label="Site" required>
        <SearchSelect
          value={siteId}
          onChange={setSiteId}
          options={(sites ?? []).map((s) => ({ value: s.id, label: s.nom }))}
          placeholder="Rechercher un site…"
        />
      </Field>
      <Field label="Portée">
        <div className="flex flex-wrap gap-2">
          {TECHNOS.map((t) => (
            <button key={t.value} type="button" onClick={() => toggleTechno(t.value)}
              className={`rounded-full border px-3 py-1 text-sm font-medium ${technos.has(t.value) ? 'border-[#1B3F6B] bg-[#1B3F6B] text-white' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-gray-400">« Site entier » = toutes les technologies down ; sinon une coupure par technologie cochée.</p>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Début de la coupure" required>
          <Input type="datetime-local" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} required />
        </Field>
        <Field label="Type d'alarme">
          <Select value={typeAlarme} onChange={(e) => setTypeAlarme(e.target.value)} options={TYPES_ALARME} placeholder="—" />
        </Field>
      </div>
      <Field label="Cause constatée"><Input value={cause} onChange={(e) => setCause(e.target.value)} placeholder="ex. Coupure de l'énergie solaire" /></Field>
      <Field label="Technicien contacté"><Input value={technicien} onChange={(e) => setTechnicien(e.target.value)} /></Field>
      <Field label="Observations"><Textarea value={observations} onChange={(e) => setObservations(e.target.value)} rows={2} /></Field>
      {siteEntier && nbAval > 0 && (
        <label className="mb-2 flex cursor-pointer items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          <input type="checkbox" checked={propagerAval} onChange={(e) => setPropagerAval(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-amber-300" />
          <span>Ce site alimente <b>{nbAval} site(s)</b> en transmission ({transmission!.aval.slice(0, 5).map((s) => s.nom).join(', ')}{nbAval > 5 ? '…' : ''}) — <b>propager la coupure</b> à tout l'aval (coupures « héritées », clôturées en cascade avec celle-ci).</span>
        </label>
      )}
      {errMsg && <p className="text-sm text-red-600">{errMsg}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">Annuler</button>
        <Button onClick={() => mutation.mutate()} disabled={!siteId || !dateDebut || mutation.isPending}>
          {mutation.isPending ? 'Enregistrement…' : 'Déclarer la coupure'}
        </Button>
      </div>
    </Modal>
  );
}

// ── Édition / clôture ───────────────────────────────────────────────────────

function CoupureEditModal({ coupure, onClose, onDone }: { coupure: Coupure; onClose: () => void; onDone: () => void }) {
  const toLocal = (iso?: string | null) => (iso ? new Date(iso).toISOString().slice(0, 16) : '');
  const [dateFin, setDateFin] = useState(toLocal(coupure.dateFin));
  const [cause, setCause] = useState(coupure.cause ?? '');
  const [actions, setActions] = useState(coupure.actions ?? '');
  const [typeAlarme, setTypeAlarme] = useState(coupure.typeAlarme ?? '');
  const [intervenants, setIntervenants] = useState(coupure.intervenants ?? '');
  const [causeCategorie, setCauseCategorie] = useState(coupure.causeCategorie ?? '');
  const [cloturerHeritees, setCloturerHeritees] = useState(true);
  const nbHeritees = coupure._count?.heritees ?? 0;
  // Retirer la date de fin d'une coupure clôturée = réouverture : l'incident
  // lié (s'il a été résolu) sera rouvert côté serveur et le prestataire notifié.
  const reouverture = !!coupure.dateFin && !dateFin;

  const mutation = useMutation({
    mutationFn: () => api.put(`/coupures-reseau/${coupure.id}`, {
      dateFin: dateFin || null,
      cloturerHeritees,
      cause: cause || null,
      actions: actions || null,
      typeAlarme: typeAlarme || null,
      intervenants: intervenants || null,
      causeCategorie: causeCategorie || null,
    }),
    onSuccess: () => { onDone(); onClose(); },
  });
  const errMsg = (mutation.error as { response?: { data?: { error?: string } } } | null)?.response?.data?.error;

  return (
    <Modal titre={`${coupure.site?.nom ?? 'Coupure'} · ${coupure.technologie === 'SITE' ? 'Site entier' : coupure.technologie}`} onClose={onClose}>
      <p className="mb-3 text-sm text-gray-500">Début : <b>{fmtDateTime(coupure.dateDebut)}</b></p>
      <Field label="Rétablissement (laisser vide si toujours en cours)">
        <Input type="datetime-local" value={dateFin} onChange={(e) => setDateFin(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type d'alarme">
          <Select value={typeAlarme} onChange={(e) => setTypeAlarme(e.target.value)} options={TYPES_ALARME} placeholder="—" />
        </Field>
        <Field label="Intervenant(s)"><Input value={intervenants} onChange={(e) => setIntervenants(e.target.value)} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Cause"><Input value={cause} onChange={(e) => setCause(e.target.value)} /></Field>
        <Field label="Classement (actif/passif)">
          <Select
            value={causeCategorie}
            onChange={(e) => setCauseCategorie(e.target.value)}
            options={[
              { value: 'ACTIF', label: 'Actif — radio/transmission' },
              { value: 'PASSIF', label: 'Passif — énergie/environnement' },
            ]}
            placeholder="(non classé)"
          />
        </Field>
      </div>
      <Field label="Actions effectuées"><Input value={actions} onChange={(e) => setActions(e.target.value)} placeholder="ex. Rétablissement de l'énergie solaire" /></Field>
      {coupure.incident && (
        <p className="mb-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
          Incident lié : <b>{coupure.incident.reference ?? coupure.incident.id.slice(0, 8)}</b> ({coupure.incident.statut})
          {reouverture && <span className="text-amber-700"> — la réouverture rouvrira cet incident et notifiera le prestataire.</span>}
        </p>
      )}
      {nbHeritees > 0 && dateFin && (
        <label className="mb-2 flex cursor-pointer items-start gap-2 rounded-lg bg-[#EAF1F8] p-3 text-sm text-[#1B3F6B]">
          <input type="checkbox" checked={cloturerHeritees} onChange={(e) => setCloturerHeritees(e.target.checked)} className="mt-0.5 h-4 w-4 rounded" />
          <span>Clôturer aussi les <b>{nbHeritees} coupure(s) héritée(s)</b> des sites en aval (même heure de rétablissement).</span>
        </label>
      )}
      {errMsg && <p className="text-sm text-red-600">{errMsg}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">Annuler</button>
        <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending ? 'Enregistrement…' : dateFin ? 'Clôturer la coupure' : 'Enregistrer'}
        </Button>
      </div>
    </Modal>
  );
}

// ── Import du rapport NOC ───────────────────────────────────────────────────

interface ImportResult {
  lignes: number; crees: number; doublonsIgnores: number;
  clotureesParImport?: number;
  incidentsResolus?: number;
  heriteesDetectees?: number;
  incidentsCrees?: number;
  sitesNonApparies: { site: string; lignes: number }[];
  erreurs: { feuille: string; ligne: number; message: string }[];
}

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const mutation = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append('file', file as File);
      const r = await api.post('/coupures-reseau/import', form);
      return r.data.data as ImportResult;
    },
    onSuccess: onDone,
  });
  const result = mutation.data;
  const errMsg = (mutation.error as { response?: { data?: { error?: string } } } | null)?.response?.data?.error;

  return (
    <Modal titre="Importer le rapport de supervision" onClose={onClose}>
      <p className="mb-3 text-sm text-gray-600">
        Fichier <b>.xlsx</b> du NOC — seule la feuille <code className="text-xs">Events</code> est importée.
        Ré-importer le même rapport ne crée pas de doublons.
      </p>
      <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="mb-3 block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-[#1B3F6B] file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-[#16345a]" />
      {errMsg && <p className="mb-2 text-sm text-red-600">{errMsg}</p>}
      {result && (
        <div className="mb-3 rounded-lg bg-gray-50 p-3 text-sm">
          <p className="flex items-center gap-1.5 font-medium text-emerald-700"><CheckCircle2 size={15} /> {result.crees} coupure(s) créée(s) · {result.doublonsIgnores} déjà connue(s) sur {result.lignes} lignes</p>
          {(result.clotureesParImport ?? 0) > 0 && (
            <p className="mt-1 text-emerald-700">{result.clotureesParImport} coupure(s) ouverte(s) clôturée(s) par le rapport (apurement).</p>
          )}
          {(result.incidentsResolus ?? 0) > 0 && (
            <p className="mt-1 text-emerald-700">
              {result.incidentsResolus} incident(s) résolu(s) automatiquement — sites rétablis sans intervention terrain.
            </p>
          )}
          {(result.heriteesDetectees ?? 0) > 0 && (
            <p className="mt-1 text-purple-700">{result.heriteesDetectees} coupure(s) reclassée(s) « héritée(s) » via la topologie (impact d&apos;une panne amont — pas d&apos;incident ni d&apos;imputation aval).</p>
          )}
          {(result.incidentsCrees ?? 0) > 0 && (
            <p className="mt-1 text-[#1B3F6B]">{result.incidentsCrees} incident(s) terrain créé(s) et dispatché(s) pour les sites entiers encore hors service.</p>
          )}
          {result.sitesNonApparies.length > 0 && (
            <div className="mt-2 text-amber-700">
              <p className="flex items-center gap-1.5 font-medium"><AlertTriangle size={14} /> Sites non reconnus ({result.sitesNonApparies.length}) :</p>
              <p className="mt-1 text-xs">{result.sitesNonApparies.slice(0, 12).map((s) => `${s.site} (${s.lignes})`).join(' · ')}{result.sitesNonApparies.length > 12 ? ' …' : ''}</p>
            </div>
          )}
          {result.erreurs.length > 0 && (
            <p className="mt-2 text-xs text-red-600">{result.erreurs.length} ligne(s) illisible(s) — ex. {result.erreurs[0].feuille} l.{result.erreurs[0].ligne} : {result.erreurs[0].message}</p>
          )}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">{result ? 'Fermer' : 'Annuler'}</button>
        {!result && (
          <Button onClick={() => mutation.mutate()} disabled={!file || mutation.isPending}>
            {mutation.isPending ? 'Import en cours…' : 'Importer'}
          </Button>
        )}
      </div>
    </Modal>
  );
}

// ── Coquille de modal locale ────────────────────────────────────────────────

function Modal({ titre, children, onClose }: { titre: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-semibold text-gray-800"><WifiOff size={17} className="text-[#1B3F6B]" /> {titre}</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
