'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
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
import { useSupervisionSocket } from '@/lib/hooks/useSupervisionSocket';
import { fmtDateTime } from '@/lib/utils';

interface Coupure {
  id: string;
  technologie: string;
  frequence?: string | null;
  source?: string; // MANUEL | OSS (détection automatique)
  priseEnChargePar?: string | null; // détection AUTO adoptée par le NOC
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
  heritees?: Coupure[];
}

/** Ligne du tableau : une racine, ou une héritée dépliée sous sa racine.
 *  `_episode` : n° d'épisode quand un site rebondit (retombe) pendant la même
 *  panne amont - deux lignes réelles, pas un doublon. */
type LigneCoupure = Coupure & { _sousLigne?: boolean; _episode?: number };

const TECHNOS = [
  { value: 'SITE', label: 'Site entier' },
  { value: '2G', label: '2G' }, { value: '3G', label: '3G' },
  { value: '4G', label: '4G' }, { value: '5G', label: '5G' },
];
// Référentiel NOC (INNER du rapport de supervision).
// « NA » (non attribué) est unifié avec « aucune » sous l'étiquette N/A :
// plus de doublon « - » / « NA » dans les menus, l'existant s'affiche N/A.
const TYPES_ALARME = ['AE', 'GE', 'EN', 'FO', 'TX', 'RA', 'MI', 'MD'].map((v) => ({ value: v, label: v }));

const dureeDepuis = (debut: string) =>
  fmtDowntime(Math.max(0, Math.round((Date.now() - new Date(debut).getTime()) / 60000)));

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
  // Écriture réservée au NOC/manager/admin - les techniciens passent par les
  // incidents, les superviseurs et prestataires consultent.
  const peutEcrire = ['NOC', 'MANAGER', 'ADMIN'].includes(role ?? '');
  const peutImporter = ['NOC', 'MANAGER', 'ADMIN'].includes(role ?? '');

  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  // Le NOC vit dans les coupures ACTIVES : la page s'ouvre dessus.
  const [statut, setStatut] = useState('EN_COURS');
  // Les héritées (aval d'une panne amont) noient la liste : masquées par
  // défaut, le badge « X impacté(s) » de la racine dit déjà l'ampleur.
  const [avecHeritees, setAvecHeritees] = useState(false);
  const [aQualifier, setAQualifier] = useState(false);
  const [technologie, setTechnologie] = useState('');
  const [typeAlarme, setTypeAlarme] = useState('');
  const [source, setSource] = useState('');
  const [du, setDu] = useState('');
  const [au, setAu] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [edition, setEdition] = useState<Coupure | null>(null);
  const debounced = useDebounce(search);
  // Push temps réel : le hook invalide coupures/stats à chaque événement -
  // le poll 5 min n'est qu'un filet de sécurité.
  useSupervisionSocket();

  interface CoupuresStats {
    enCours: number; enCoursSiteEntier: number; enCoursHeritees: number; terminees: number;
    nouvellesDerniereHeure: number; aQualifier: number; enCoursAuto: number; enCoursManuel: number;
    plusAncienne?: { dateDebut: string; technologie: string; site?: { nom: string } } | null;
  }
  const { data: stats } = useQuery({
    queryKey: ['coupures-stats'],
    queryFn: () => api.get('/coupures-reseau/stats').then((r) => r.data.data as CoupuresStats),
    refetchInterval: 300_000,
  });

  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey: ['coupures', { page, debounced, statut, technologie, typeAlarme, source, du, au, avecHeritees, aQualifier }],
    // Filet de sécurité 5 min : le push temps réel (socket) est la voie
    // principale de rafraîchissement.
    refetchInterval: 300_000,
    // Changement d'onglet/filtre/page : l'ancien contenu RESTE affiché pendant
    // le chargement du nouveau - fini le squelette qui remonte toute la page.
    placeholderData: keepPreviousData,
    queryFn: () => api.get('/coupures-reseau', {
      params: {
        page, limit: 20,
        search: debounced || undefined, statut: statut || undefined,
        technologie: technologie || undefined, type_alarme: typeAlarme || undefined,
        source: source || undefined,
        // Racines seulement : l'aval hérité arrive EMBARQUÉ sous chaque racine
        // (sous-lignes dépliables). En recherche, on repasse à plat pour
        // retrouver aussi un site uniquement hérité.
        origine: debounced ? undefined : 'LOCALE',
        a_qualifier: aQualifier ? '1' : undefined,
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
    source && `source=${source}`,
    // Fidélité affichage/export : en recherche la liste passe à plat (héritées
    // incluses), l'export doit suivre.
    !debounced && !avecHeritees && 'origine=LOCALE',
    aQualifier && 'a_qualifier=1',
    du && `date_debut=${du}`,
    au && `date_fin=${au}`,
  ].filter(Boolean).join('&');
  const rows: Coupure[] = data?.data ?? [];
  // Aval déplié : chaque héritée devient une sous-ligne indentée sous sa
  // racine (jamais en recherche : le serveur renvoie alors la vue à plat).
  const lignes: LigneCoupure[] = !debounced && avecHeritees
    ? rows.flatMap((r) => [
        { ...r } as LigneCoupure,
        ...(r.heritees ?? []).map((h, idx, arr) => {
          // Site retombé pendant la même panne (rebond) : numéroter les
          // épisodes pour que deux lignes du même site ne lisent pas en doublon.
          const memeSite = arr.filter((x) => x.site?.nom === h.site?.nom);
          const episode = memeSite.length > 1 ? memeSite.indexOf(h) + 1 : 0;
          return { ...h, _sousLigne: true, _episode: episode, coupureOrigine: { id: r.id, site: r.site } };
        }),
      ])
    : rows.map((r) => ({ ...r } as LigneCoupure));
  // Rebond au niveau RACINE aussi (ex. plongeon de 2 min puis vraie panne) :
  // un même site plusieurs fois parmi les racines de la page → épisodes
  // numérotés chronologiquement.
  {
    const racinesParSite = new Map<string, LigneCoupure[]>();
    for (const l of lignes) {
      if (l._sousLigne) continue;
      const cle = l.site?.nom ?? '—';
      const liste = racinesParSite.get(cle) ?? [];
      liste.push(l); racinesParSite.set(cle, liste);
    }
    for (const liste of racinesParSite.values()) {
      if (liste.length < 2) continue;
      [...liste]
        .sort((a, b) => new Date(a.dateDebut).getTime() - new Date(b.dateDebut).getTime())
        .forEach((l, i) => { l._episode = i + 1; });
    }
  }
  const meta: PaginationMeta | undefined = data?.meta;
  const rafraichir = () => {
    queryClient.invalidateQueries({ queryKey: ['coupures'] });
    queryClient.invalidateQueries({ queryKey: ['coupures-stats'] });
  };

  const columns: Column<LigneCoupure>[] = [
    {
      key: 'site', header: 'Site', sortValue: (c) => c.site?.nom,
      render: (c) => c._sousLigne ? (
        // Sous-ligne : héritée dépliée sous sa racine, indentée.
        <span className="flex items-center pl-4 text-gray-500">
          <span className="mr-1.5 text-purple-400">↳</span>
          {c.site?.nom ?? '—'}
          <span className="ml-1.5 rounded-full bg-purple-50 px-1.5 py-0.5 text-[10px] font-bold text-purple-700">héritée</span>
          {(c._episode ?? 0) > 0 && (
            <span className="ml-1.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700"
              title="Ce site est retombé pendant la même panne amont : chaque épisode a sa propre durée d'indisponibilité (le site ne compte qu'une fois dans « impactés »).">
              épisode {c._episode}
            </span>
          )}
        </span>
      ) : (
        <span className="font-medium text-gray-800">
          {c.site?.nom ?? '—'}
          {(c._episode ?? 0) > 0 && (
            <span className="ml-1.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700"
              title="Ce site a connu plusieurs pannes successives (rebond) : chaque ligne est un épisode réel avec sa propre durée.">
              épisode {c._episode}
            </span>
          )}
          {c.origine === 'HERITEE' && (
            <span className="ml-1.5 rounded-full bg-purple-50 px-1.5 py-0.5 text-[10px] font-bold text-purple-700" title={`Impact hérité de ${c.coupureOrigine?.site?.nom ?? 'un site amont'}`}>
              ← {c.coupureOrigine?.site?.nom ?? 'amont'}
            </span>
          )}
          {(c._count?.heritees ?? 0) > 0 && (() => {
            // SITES distincts : un site portant deux coupures héritées (OSS +
            // rapport) comptait double. « rétabli » seulement si TOUTES ses
            // lignes sont refermées.
            const parSite = new Map<string, boolean>();
            for (const h of c.heritees ?? []) {
              const nomS = h.site?.nom ?? '—';
              parSite.set(nomS, (parSite.get(nomS) ?? false) || !h.dateFin);
            }
            const n = parSite.size || c._count!.heritees;
            return (
              <span className="ml-1.5 cursor-help rounded-full bg-[#EAF1F8] px-1.5 py-0.5 text-[10px] font-bold text-[#1B3F6B]"
                title={`Sites impactés en aval :\n${[...parSite.entries()].slice(0, 20).map(([nomS, ouverte]) => `• ${nomS}${ouverte ? '' : ' (rétabli)'}`).join('\n')}${parSite.size > 20 ? '\n…' : ''}`}>
                {n} impacté(s)
              </span>
            );
          })()}
        </span>
      ),
    },
    {
      key: 'technologie', header: 'Technologie',
      // Fréquence et secteur (fichier NOC) : stockés depuis toujours mais
      // jamais affichés - c'est pourtant ce qui distingue deux coupures 4G
      // du même site (L800 secteur 2 ≠ L1800 secteur 1).
      render: (c) => (
        <div>
          <TechnoBadge t={c.technologie} />
          {c.source === 'OSS' && (
            <span className={`ml-1.5 rounded px-1 py-px text-[10px] font-bold ${c.priseEnChargePar ? 'bg-emerald-50 text-emerald-700' : 'bg-indigo-50 text-indigo-600'}`}
              title={c.priseEnChargePar
                ? `Détection automatique prise en charge par ${c.priseEnChargePar}`
                : 'Détectée automatiquement par la synchronisation OSS (état eNodeB) - à prendre en charge'}>
              {c.priseEnChargePar ? '✓ AUTO' : 'AUTO'}
            </span>
          )}
          {(c.frequence || c.secteur) && (
            <p className="mt-0.5 text-[11px] text-gray-500">
              {[c.frequence, c.secteur && `sect. ${c.secteur}`].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
      ),
    },
    { key: 'dateDebut', header: 'Début', render: (c) => fmtDateTime(c.dateDebut) },
    {
      key: 'dateFin', header: 'Fin',
      // En cours : la durée ÉCOULÉE court et « vieillit » (rouge dès 24 h).
      render: (c) => {
        if (c.dateFin) return fmtDateTime(c.dateFin);
        const min = Math.max(0, Math.round((Date.now() - new Date(c.dateDebut).getTime()) / 60000));
        return (
          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${min >= 1440 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
            EN COURS · {fmtDowntime(min)}
          </span>
        );
      },
    },
    { key: 'downtimeMinutes', header: 'Downtime', align: 'right', render: (c) => fmtDowntime(c.downtimeMinutes) },
    { key: 'typeAlarme', header: 'Alarme', align: 'center', render: (c) => (!c.typeAlarme || c.typeAlarme === 'NA') ? 'N/A' : c.typeAlarme },
    { key: 'cause', header: 'Cause', render: (c) => <span className="text-gray-600">{c.cause ?? '—'}</span> },
    // Colonnes complémentaires : masquées par défaut pour garder le tableau
    // lisible, mais proposées dans le sélecteur « Colonnes » (choix mémorisé).
    { key: 'region', header: 'Région', defaultHidden: true, sortValue: (c) => c.site?.region, render: (c) => c.site?.region ?? '—' },
    { key: 'frequence', header: 'Fréquence', defaultHidden: true, render: (c) => c.frequence ?? '—' },
    { key: 'secteur', header: 'Secteur', defaultHidden: true, render: (c) => c.secteur ?? '—' },
    {
      key: 'causeCategorie', header: 'Classement', defaultHidden: true,
      render: (c) => c.causeCategorie === 'ACTIF' ? 'Actif' : c.causeCategorie === 'PASSIF' ? 'Passif' : '—',
    },
    { key: 'actions', header: 'Actions effectuées', defaultHidden: true, render: (c) => <span className="text-gray-600">{c.actions ?? '—'}</span> },
    { key: 'technicienContacte', header: 'Technicien contacté', defaultHidden: true, render: (c) => c.technicienContacte ?? '—' },
    { key: 'intervenants', header: 'Intervenant(s)', defaultHidden: true, render: (c) => c.intervenants ?? '—' },
    { key: 'observations', header: 'Observations', defaultHidden: true, render: (c) => <span className="text-gray-600">{c.observations ?? '—'}</span> },
    {
      key: 'incident', header: 'Incident', defaultHidden: true, sortable: false,
      render: (c) => c.incident ? `${c.incident.reference ?? c.incident.id.slice(0, 8)} (${c.incident.statut})` : '—',
    },
    {
      key: 'source', header: 'Source', defaultHidden: true,
      render: (c) => c.source === 'OSS'
        ? (c.priseEnChargePar ? `AUTO · ${c.priseEnChargePar}` : 'AUTO (OSS)')
        : 'Manuelle',
    },
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
            <ExportButtons base="/coupures-reseau/export"
              name={`coupures-reseau${du || au ? `_du-${du || 'origine'}_au-${au || 'ce-jour'}` : ''}`}
              query={exportQuery || undefined} />
          </>
        }
      />

      {/* Bandeau de situation : l'opérateur sait en un coup d'œil si c'est calme. */}
      {stats && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-gray-100 bg-white px-4 py-3">
            <p className="text-xs text-gray-500">Coupures en cours</p>
            <p className="mt-0.5 text-lg font-bold text-gray-800">
              {stats.enCours}
              {stats.enCoursSiteEntier > 0 && (
                <span className="ml-1.5 text-xs font-semibold text-red-600">dont {stats.enCoursSiteEntier} site(s) entier(s)</span>
              )}
            </p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-white px-4 py-3">
            <p className="text-xs text-gray-500">Plus ancienne en cours</p>
            {stats.plusAncienne ? (
              <p className="mt-0.5 truncate text-sm font-bold text-gray-800" title={stats.plusAncienne.site?.nom}>
                {stats.plusAncienne.site?.nom ?? '—'}
                <span className="ml-1.5 rounded-full bg-red-50 px-1.5 py-0.5 text-xs font-bold text-red-700">
                  {dureeDepuis(stats.plusAncienne.dateDebut)}
                </span>
              </p>
            ) : <p className="mt-0.5 text-sm font-bold text-emerald-600">aucune</p>}
          </div>
          <div className="rounded-xl border border-gray-100 bg-white px-4 py-3">
            <p className="text-xs text-gray-500">Nouvelles (1 h)</p>
            <p className={`mt-0.5 text-lg font-bold ${stats.nouvellesDerniereHeure > 0 ? 'text-amber-600' : 'text-gray-800'}`}>
              {stats.nouvellesDerniereHeure}
            </p>
          </div>
          <button type="button" onClick={() => { setAQualifier(!aQualifier); setPage(1); }}
            title="Coupures en cours sans type d'alarme ou sans classement actif/passif - à compléter pour les rapports. Cliquer pour filtrer."
            className={`rounded-xl border px-4 py-3 text-left transition-colors ${aQualifier ? 'border-[#1B3F6B] bg-[#EAF1F8]' : 'border-gray-100 bg-white hover:bg-gray-50'}`}>
            <p className="text-xs text-gray-500">À qualifier {aQualifier && '· filtre actif'}</p>
            <p className={`mt-0.5 text-lg font-bold ${stats.aQualifier > 0 ? 'text-[#1B3F6B]' : 'text-gray-800'}`}>{stats.aQualifier}</p>
          </button>
        </div>
      )}

      {/* Onglets d'état + héritées : la vue par défaut = coupures actives, racines seulement. */}
      <div className="mb-3 flex flex-wrap items-center gap-4">
        <div className="flex w-fit gap-1 rounded-lg bg-gray-100 p-1">
          {[
            { v: 'EN_COURS', l: `En cours${stats ? ` (${Math.max(0, stats.enCours - stats.enCoursHeritees)})` : ''}` },
            { v: 'TERMINEE', l: 'Rétablies' },
            { v: '', l: 'Toutes' },
          ].map((o) => (
            <button key={o.v} type="button" onClick={() => { setStatut(o.v); setPage(1); }}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${statut === o.v ? 'bg-white text-[#1B3F6B] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {o.l}
            </button>
          ))}
        </div>
        {/* Sas AUTO (détections non traitées) vs rapport NOC : une AUTO prise
            en charge REJOINT le rapport NOC - c'est lui qui est envoyé et qui
            fonde la disponibilité. Compteurs sur les coupures en cours. */}
        <div className="flex w-fit gap-1 rounded-lg bg-gray-100 p-1">
          {[
            { v: '', l: 'Toutes sources' },
            { v: 'OSS', l: `AUTO à traiter${stats ? ` (${stats.enCoursAuto})` : ''}` },
            { v: 'MANUEL', l: `Rapport NOC${stats ? ` (${stats.enCoursManuel})` : ''}` },
          ].map((o) => (
            <button key={o.v} type="button" onClick={() => { setSource(o.v); setPage(1); }}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${source === o.v ? 'bg-white text-[#1B3F6B] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {o.l}
            </button>
          ))}
        </div>
        <label className="flex cursor-pointer items-center gap-1.5 text-sm text-gray-600">
          <input type="checkbox" checked={avecHeritees} onChange={(e) => { setAvecHeritees(e.target.checked); setPage(1); }}
            className="h-4 w-4 rounded border-gray-300" />
          Déplier l&apos;aval hérité sous chaque racine{stats && stats.enCoursHeritees > 0 ? ` (${stats.enCoursHeritees} en cours)` : ''}
        </label>
        {isFetching && !isLoading && (
          <span className="ml-auto animate-pulse text-xs text-gray-400">actualisation…</span>
        )}
      </div>

      <FilterBar
        search={search}
        onSearch={(v) => { setSearch(v); setPage(1); }}
        searchPlaceholder="Rechercher un site…"
        filters={[
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
            <DataTable columns={columns} data={lignes} maxHeight="65vh" onRowClick={peutEcrire ? (c) => setEdition(c) : undefined} />
            <Pagination meta={meta} onChange={setPage} />
          </>
        )}

      {showCreate && (
        <CoupureFormModal
          onClose={() => setShowCreate(false)}
          onDone={rafraichir}
          onOuvrirExistante={async (coupureId, sId) => {
            // Passerelle depuis la garde « déjà en cours » : bascule du
            // formulaire de création vers la coupure existante du site.
            try {
              const r = await api.get('/coupures-reseau', {
                params: { site_id: sId, statut: 'EN_COURS', technologie: 'SITE', limit: 5 },
              });
              const liste = (r.data.data ?? []) as Coupure[];
              const cible = liste.find((c) => c.id === coupureId) ?? liste[0];
              if (cible) { setShowCreate(false); setEdition(cible); }
            } catch { /* la liste reste ouverte, l'erreur du formulaire est déjà affichée */ }
          }}
        />
      )}
      {edition && <CoupureEditModal coupure={edition} onClose={() => setEdition(null)} onDone={rafraichir} />}
      {showImport && <ImportModal onClose={() => setShowImport(false)} onDone={rafraichir} />}
    </div>
  );
}

// ── Création ────────────────────────────────────────────────────────────────

function CoupureFormModal({ onClose, onDone, onOuvrirExistante }: {
  onClose: () => void; onDone: () => void;
  onOuvrirExistante?: (coupureId: string, siteId: string) => void;
}) {
  const { data: sites } = useQuery({
    queryKey: ['sites-all'],
    queryFn: () => api.get('/sites', { params: { all: 'true' } }).then((r) => r.data.data as { id: string; nom: string }[]),
    staleTime: 5 * 60_000,
  });
  const [siteId, setSiteId] = useState('');
  const [technos, setTechnos] = useState<Set<string>>(new Set(['SITE']));
  const [dateDebut, setDateDebut] = useState('');
  const [typeAlarme, setTypeAlarme] = useState('');
  const [frequence, setFrequence] = useState('');
  const [secteur, setSecteur] = useState('');
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
      frequence: frequence || undefined,
      secteur: secteur || undefined,
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

  const errData = (mutation.error as { response?: { data?: { error?: string; details?: { coupureExistanteId?: string } } } } | null)?.response?.data;
  const errMsg = errData?.error;
  const coupureExistanteId = errData?.details?.coupureExistanteId;

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
          <Select value={typeAlarme} onChange={(e) => setTypeAlarme(e.target.value)} options={TYPES_ALARME} placeholder="N/A" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Fréquence / bande">
          <Input value={frequence} onChange={(e) => setFrequence(e.target.value)} placeholder="ex. L800, U900" />
        </Field>
        <Field label="Secteur">
          <Input value={secteur} onChange={(e) => setSecteur(e.target.value)} placeholder="ex. S2" />
        </Field>
      </div>
      <Field label="Cause constatée"><Input value={cause} onChange={(e) => setCause(e.target.value)} placeholder="ex. Coupure de l'énergie solaire" /></Field>
      <Field label="Technicien contacté"><Input value={technicien} onChange={(e) => setTechnicien(e.target.value)} /></Field>
      <Field label="Observations"><Textarea value={observations} onChange={(e) => setObservations(e.target.value)} rows={2} /></Field>
      {siteEntier && nbAval > 0 && (
        <label className="mb-2 flex cursor-pointer items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          <input type="checkbox" checked={propagerAval} onChange={(e) => setPropagerAval(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-amber-300" />
          <span>Ce site alimente <b>{nbAval} site(s)</b> en transmission ({transmission!.aval.slice(0, 5).map((s) => s.nom).join(', ')}{nbAval > 5 ? '…' : ''}) - <b>propager la coupure</b> à tout l'aval (coupures « héritées », clôturées en cascade avec celle-ci).</span>
        </label>
      )}
      {errMsg && (
        <div className="rounded-lg bg-red-50 p-3">
          <p className="text-sm text-red-700">{errMsg}</p>
          {coupureExistanteId && onOuvrirExistante && (
            <button type="button"
              onClick={() => onOuvrirExistante(coupureExistanteId, siteId)}
              className="mt-2 rounded-lg bg-[#1B3F6B] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#16345a]">
              Ouvrir la coupure en cours de ce site →
            </button>
          )}
        </div>
      )}
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
  const [dateDebut, setDateDebut] = useState(toLocal(coupure.dateDebut));
  const [dateFin, setDateFin] = useState(toLocal(coupure.dateFin));
  const [cause, setCause] = useState(coupure.cause ?? '');
  const [actions, setActions] = useState(coupure.actions ?? '');
  const [typeAlarme, setTypeAlarme] = useState(coupure.typeAlarme === 'NA' ? '' : coupure.typeAlarme ?? '');
  const [intervenants, setIntervenants] = useState(coupure.intervenants ?? '');
  const [causeCategorie, setCauseCategorie] = useState(coupure.causeCategorie ?? '');
  const [cloturerHeritees, setCloturerHeritees] = useState(true);
  const nbHeritees = coupure._count?.heritees ?? 0;
  // Retirer la date de fin d'une coupure clôturée = réouverture : l'incident
  // lié (s'il a été résolu) sera rouvert côté serveur et le prestataire notifié.
  const reouverture = !!coupure.dateFin && !dateFin;

  const mutation = useMutation({
    mutationFn: () => api.put(`/coupures-reseau/${coupure.id}`, {
      // Début envoyé seulement s'il a été corrigé (l'audit trace l'ancien).
      ...(dateDebut && dateDebut !== toLocal(coupure.dateDebut) ? { dateDebut } : {}),
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
      {coupure.source === 'OSS' && !coupure.priseEnChargePar && !coupure.dateFin && (
        <PriseEnChargeBloc coupureId={coupure.id} onDone={onDone} />
      )}
      {coupure.priseEnChargePar && (
        <AnnulationPriseEnChargeBloc coupureId={coupure.id} priseEnChargePar={coupure.priseEnChargePar} onDone={onDone} />
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Début (corrigeable - l'audit garde l'ancien)">
          <Input type="datetime-local" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} />
        </Field>
        <Field label="Rétablissement (vide = en cours)">
          <Input type="datetime-local" value={dateFin} onChange={(e) => setDateFin(e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type d'alarme">
          <Select value={typeAlarme} onChange={(e) => setTypeAlarme(e.target.value)} options={TYPES_ALARME} placeholder="N/A" />
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
              { value: 'ACTIF', label: 'Actif - radio/transmission' },
              { value: 'PASSIF', label: 'Passif - énergie/environnement' },
            ]}
            placeholder="(non classé)"
          />
        </Field>
      </div>
      <Field label="Actions effectuées"><Input value={actions} onChange={(e) => setActions(e.target.value)} placeholder="ex. Rétablissement de l'énergie solaire" /></Field>
      {coupure.incident && (
        <p className="mb-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
          Incident lié : <b>{coupure.incident.reference ?? coupure.incident.id.slice(0, 8)}</b> ({coupure.incident.statut})
          {reouverture && <span className="text-amber-700"> - la réouverture rouvrira cet incident et notifiera le prestataire.</span>}
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

// ── Prise en charge d'une détection AUTO ────────────────────────────────────
// Le NOC adopte l'événement ; le serveur remonte la chaîne de transmission :
// si un site AMONT est aussi coupé, c'est lui la racine - les coupures aval
// (dont celle-ci) sont reclassées héritées et la liste retombe à un événement.

function PriseEnChargeBloc({ coupureId, onDone }: { coupureId: string; onDone: () => void }) {
  const [creerAval, setCreerAval] = useState(true);
  const [creerIncident, setCreerIncident] = useState(false);
  const [resultat, setResultat] = useState<{
    racineSiteNom: string; estRacine: boolean; heriteesReclassees: number; heriteesCreees: number; priseEnChargePar: string;
    incident?: { id: string; reference: string | null; reutilise: boolean } | null;
  } | null>(null);
  const mutation = useMutation({
    mutationFn: () => api.post(`/coupures-reseau/${coupureId}/prise-en-charge`, { creerAvalManquant: creerAval, creerIncident }).then((r) => r.data.data),
    onSuccess: (d) => { setResultat(d); onDone(); },
  });
  const errMsg = (mutation.error as { response?: { data?: { error?: string } } } | null)?.response?.data?.error;

  return (
    <div className="mb-3 rounded-lg bg-indigo-50 p-3 text-sm text-indigo-900">
      {resultat ? (
        <p>
          <CheckCircle2 size={14} className="mr-1 inline text-emerald-600" />
          Pris en charge par <b>{resultat.priseEnChargePar}</b> - racine : <b>{resultat.racineSiteNom}</b>
          {!resultat.estRacine && <span className="text-amber-700"> (panne amont détectée : cette coupure devient héritée)</span>}
          {resultat.heriteesReclassees > 0 && <> · <b>{resultat.heriteesReclassees}</b> coupure(s) aval reclassée(s) héritée(s)</>}
          {resultat.heriteesCreees > 0 && <> · <b>{resultat.heriteesCreees}</b> héritée(s) créée(s) pour l&apos;aval sans détection</>}
          {resultat.incident && (
            <span className="text-red-700">
              {' '}· incident <b>{resultat.incident.reference ?? resultat.incident.id.slice(0, 8)}</b>
              {resultat.incident.reutilise ? ' rattaché (déjà ouvert sur ce site)' : ' créé - SMS et dispatch terrain envoyés'}
            </span>
          )}
        </p>
      ) : (
        <>
          <p className="mb-2">
            Détection automatique OSS <b>non prise en charge</b>. La prise en charge analyse la
            topologie : si un site <b>amont</b> est aussi coupé, il devient la racine de l&apos;événement
            et les coupures de l&apos;aval passent en héritées (une seule panne, une seule ligne).
          </p>
          <label className="mb-2 flex cursor-pointer items-start gap-2 text-xs">
            <input type="checkbox" checked={creerAval} onChange={(e) => setCreerAval(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 rounded" />
            <span>Créer les héritées pour les sites aval <b>sans détection OSS propre</b> (pas de NodeID) - leur indisponibilité comptera dans le rapport.</span>
          </label>
          <label className="mb-2 flex cursor-pointer items-start gap-2 rounded-md bg-red-50 p-2 text-xs text-red-800">
            <input type="checkbox" checked={creerIncident} onChange={(e) => setCreerIncident(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 rounded border-red-300" />
            <span>
              <b>Déclencher le terrain</b> : créer l&apos;incident CRITIQUE sur la racine -
              <b> SMS RÉELS aux contacts passifs du lot</b> + notification aux techniciens.
              (Si un incident est déjà ouvert sur ce site, la coupure y est rattachée sans nouveau SMS.)
            </span>
          </label>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? 'Analyse de la topologie…' : 'Prendre en charge (analyse amont/aval)'}
          </Button>
          {errMsg && <p className="mt-2 text-xs text-red-600">{errMsg}</p>}
        </>
      )}
    </div>
  );
}

// ── Annulation d'une prise en charge erronée ────────────────────────────────
// Défait proprement l'adoption : héritées fabriquées supprimées, héritées
// reclassées redevenues locales, estampille retirée - le NOC peut refaire
// l'analyse depuis la bonne coupure.

function AnnulationPriseEnChargeBloc({ coupureId, priseEnChargePar, onDone }: {
  coupureId: string; priseEnChargePar: string; onDone: () => void;
}) {
  const [resultat, setResultat] = useState<{ heriteesSupprimees: number; heriteesRedeclassees: number } | null>(null);
  const mutation = useMutation({
    mutationFn: () => api.post(`/coupures-reseau/${coupureId}/annuler-prise-en-charge`).then((r) => r.data.data),
    onSuccess: (d) => { setResultat(d); onDone(); },
  });
  const errMsg = (mutation.error as { response?: { data?: { error?: string } } } | null)?.response?.data?.error;

  return (
    <div className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
      {resultat ? (
        <p className="text-amber-800">
          Prise en charge <b>annulée</b> - {resultat.heriteesSupprimees > 0 && <>{resultat.heriteesSupprimees} héritée(s) fabriquée(s) supprimée(s) · </>}
          {resultat.heriteesRedeclassees} coupure(s) redevenue(s) locale(s). Refaites l&apos;analyse depuis la bonne coupure.
        </p>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p>Prise en charge par <b>{priseEnChargePar}</b>.</p>
          <button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending}
            title="Erreur d'adoption : supprime les héritées fabriquées, re-déclasse les autres en locales, retire l'estampille."
            className="font-medium text-red-600 hover:underline disabled:opacity-50">
            {mutation.isPending ? 'Annulation…' : 'Annuler la prise en charge'}
          </button>
          {errMsg && <p className="w-full text-red-600">{errMsg}</p>}
        </div>
      )}
    </div>
  );
}

// ── Import du rapport NOC ───────────────────────────────────────────────────

interface ImportResult {
  lignes: number; crees: number; doublonsIgnores: number;
  clotureesParImport?: number;
  dejaCouvertesParDetection?: number;
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
        Fichier <b>.xlsx</b> du NOC - seule la feuille <code className="text-xs">Events</code> est importée.
        Ré-importer le même rapport ne crée pas de doublons.
      </p>
      <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="mb-3 block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-[#1B3F6B] file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-[#16345a]" />
      {errMsg && <p className="mb-2 text-sm text-red-600">{errMsg}</p>}
      {result && (
        <div className="mb-3 rounded-lg bg-gray-50 p-3 text-sm">
          <p className="flex items-center gap-1.5 font-medium text-emerald-700"><CheckCircle2 size={15} /> {result.crees} coupure(s) créée(s) · {result.doublonsIgnores} déjà connue(s) sur {result.lignes} lignes</p>
          {(result.dejaCouvertesParDetection ?? 0) > 0 && (
            <p className="mt-1 text-indigo-700">
              {result.dejaCouvertesParDetection} ligne(s) site entier sautée(s) : la panne est déjà suivie par la détection AUTO (une seule coupure ouverte par site).
            </p>
          )}
          {(result.clotureesParImport ?? 0) > 0 && (
            <p className="mt-1 text-emerald-700">{result.clotureesParImport} coupure(s) ouverte(s) clôturée(s) par le rapport (apurement).</p>
          )}
          {(result.incidentsResolus ?? 0) > 0 && (
            <p className="mt-1 text-emerald-700">
              {result.incidentsResolus} incident(s) résolu(s) automatiquement - sites rétablis sans intervention terrain.
            </p>
          )}
          {(result.heriteesDetectees ?? 0) > 0 && (
            <p className="mt-1 text-purple-700">{result.heriteesDetectees} coupure(s) reclassée(s) « héritée(s) » via la topologie (impact d&apos;une panne amont - pas d&apos;incident ni d&apos;imputation aval).</p>
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
            <p className="mt-2 text-xs text-red-600">{result.erreurs.length} ligne(s) illisible(s) - ex. {result.erreurs[0].feuille} l.{result.erreurs[0].ligne} : {result.erreurs[0].message}</p>
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
