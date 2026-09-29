'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, AlertTriangle, Wrench } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { FilterBar } from '@/components/shared/FilterBar';
import { DataTable, Column } from '@/components/shared/DataTable';
import { Pagination, PaginationMeta } from '@/components/shared/Pagination';
import { TableSkeleton, EmptyState, ErrorState } from '@/components/shared/states';
import { Button } from '@/components/shared/Button';
import { Field, Textarea } from '@/components/shared/Form';
import { fmtDateTime } from '@/lib/utils';

interface Anomalie {
  id: string;
  code: string;
  champ: string;
  message: string;
  valeurSaisie: string | null;
  valeurAttendue: string | null;
  source: string;
  confirmee: boolean;
  statut: string;
  motifTraitement: string | null;
  traiteeLe: string | null;
  createdAt: string;
  site: { id: string; code: string; nom: string; region: string | null };
}

/** Libellés courts : le message complet est sous la ligne, pas dans la colonne. */
const LIBELLE_CODE: Record<string, string> = {
  CUVE_DEPASSEE: 'Cuve dépassée',
  INDEX_GE_RECULE: 'Index GE en baisse',
  HEURES_GE_ABERRANTES: 'Bond d’heures GE',
  INDEX_CEET_RECULE: 'Index CEET en baisse',
  CONSO_CEET_ABERRANTE: 'Conso CEET aberrante',
  STOCK_AVANT_CUVE: 'Stock avant > cuve',
  STOCK_APRES_CUVE: 'Stock après > cuve',
  STOCK_AVANT_HAUSSE: 'Niveau remonté sans dépotage',
  DEPOTAGE_DOUBLON: 'Dépotage en double',
};
const LIBELLE_SOURCE: Record<string, string> = {
  MAINTENANCE: 'Clôture', DEPOTAGE: 'Dépotage', RELEVE: 'Relevé',
};

const STATUTS = [
  { value: 'A_VERIFIER', label: 'À vérifier' },
  { value: 'JUSTIFIEE', label: 'Justifiée' },
  { value: 'A_CORRIGER', label: 'À corriger' },
];

function BadgeStatut({ value }: { value: string }) {
  const style = value === 'JUSTIFIEE' ? 'bg-green-50 text-green-700 ring-green-100'
    : value === 'A_CORRIGER' ? 'bg-red-50 text-red-700 ring-red-100'
    : 'bg-amber-50 text-amber-800 ring-amber-100';
  const texte = STATUTS.find((s) => s.value === value)?.label ?? value;
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${style}`}>{texte}</span>;
}

/**
 * ANOMALIES DE SAISIE : ce que les contrôles de vraisemblance ont relevé.
 *
 * Une valeur inhabituelle peut être légitime - compteur remplacé, cuve
 * agrandie. L'écran ne sert donc pas à accuser mais à FERMER : chaque ligne
 * doit finir justifiée (avec son motif) ou à corriger.
 */
function AnomaliesSaisieEcran() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role ?? '';
  const peutTraiter = ['SUPERVISEUR', 'MANAGER', 'ADMIN'].includes(role);
  const queryClient = useQueryClient();

  // ARRIVÉE DEPUIS UN ÉCRAN CARBURANT : les rapports renvoient ici avec le site
  // en question. Sans ce filtre, le lien retombait sur la liste entière et il
  // fallait retrouver le site à la main.
  const params = useSearchParams();
  const siteId = params.get('site_id') ?? '';
  const [statut, setStatut] = useState('A_VERIFIER');
  const [code, setCode] = useState('');
  const [source, setSource] = useState('');
  const [page, setPage] = useState(1);
  const [cible, setCible] = useState<Anomalie | null>(null);
  const [motif, setMotif] = useState('');
  const [erreur, setErreur] = useState('');
  const [busy, setBusy] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['anomalies', { statut, code, source, page, siteId }],
    queryFn: () => api.get('/anomalies-saisie', {
      params: { page, limit: 30, statut: statut || undefined, code: code || undefined, source: source || undefined, site_id: siteId || undefined },
    }).then((r) => r.data),
  });

  const traiter = async (a: Anomalie, nouveau: 'JUSTIFIEE' | 'A_CORRIGER', motifSaisi = '') => {
    setErreur(''); setBusy(a.id);
    try {
      await api.patch(`/anomalies-saisie/${a.id}`, { statut: nouveau, motif: motifSaisi });
      queryClient.invalidateQueries({ queryKey: ['anomalies'] });
      setCible(null); setMotif('');
    } catch (e) {
      setErreur((e as { response?: { data?: { error?: string } } }).response?.data?.error ?? 'Traitement impossible.');
    } finally {
      setBusy('');
    }
  };

  const lignes: Anomalie[] = data?.data ?? [];
  const meta: PaginationMeta | undefined = data?.meta;
  const aVerifier = data?.meta?.aVerifier ?? 0;

  const columns: Column<Anomalie>[] = [
    { key: 'createdAt', header: 'Date', render: (a) => <span className="text-xs text-gray-500">{fmtDateTime(a.createdAt)}</span> },
    { key: 'site', header: 'Site', render: (a) => <span className="font-medium text-gray-800">{a.site?.nom ?? '-'}</span> },
    { key: 'code', header: 'Anomalie', render: (a) => (
      <div>
        <p className="font-medium text-gray-800">{LIBELLE_CODE[a.code] ?? a.code}</p>
        <p className="max-w-xl text-xs text-gray-500">{a.message}</p>
        {a.motifTraitement && <p className="mt-0.5 text-xs italic text-green-700">Motif : {a.motifTraitement}</p>}
      </div>
    ) },
    { key: 'source', header: 'Origine', render: (a) => (
      <span className="text-xs text-gray-600">
        {LIBELLE_SOURCE[a.source] ?? a.source}
        {/* Confirmée = le technicien a vu l'avertissement et maintenu sa saisie. */}
        {a.confirmee && <span className="ml-1 text-gray-400">· confirmée</span>}
      </span>
    ) },
    { key: 'statut', header: 'Statut', render: (a) => <BadgeStatut value={a.statut} /> },
    ...(peutTraiter ? [{
      key: 'actions',
      header: '',
      render: (a: Anomalie) => (a.statut === 'A_VERIFIER' ? (
        <div className="flex gap-1.5">
          <Button variant="secondary" icon={CheckCircle2} onClick={() => { setCible(a); setMotif(''); setErreur(''); }}>
            Justifier
          </Button>
          <Button variant="secondary" icon={Wrench} loading={busy === a.id} onClick={() => traiter(a, 'A_CORRIGER')}>
            À corriger
          </Button>
        </div>
      ) : null),
    } as Column<Anomalie>] : []),
  ];

  return (
    <div>
      <PageHeader
        title="Anomalies de saisie"
        subtitle="Valeurs relevées par les contrôles de vraisemblance, à justifier ou à corriger"
        backHref="/supervision/carte"
      />

      {aVerifier > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          <AlertTriangle size={15} /> {aVerifier} anomalie(s) à vérifier dans ce filtre.
        </div>
      )}
      {erreur && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{erreur}</div>}

      <FilterBar
        filters={[
          { key: 'statut', label: 'Tous statuts', value: statut, options: STATUTS, onChange: (v) => { setStatut(v); setPage(1); } },
          { key: 'code', label: 'Toutes anomalies', value: code,
            options: Object.entries(LIBELLE_CODE).map(([value, label]) => ({ value, label })),
            onChange: (v) => { setCode(v); setPage(1); } },
          { key: 'source', label: 'Toutes origines', value: source,
            options: Object.entries(LIBELLE_SOURCE).map(([value, label]) => ({ value, label })),
            onChange: (v) => { setSource(v); setPage(1); } },
        ]}
      />

      {isLoading ? <TableSkeleton cols={5} />
        : isError ? <ErrorState />
        : !lignes.length ? (
          <EmptyState
            title="Aucune anomalie"
            hint={statut === 'A_VERIFIER' ? 'Rien à vérifier : toutes les saisies du filtre sont cohérentes ou déjà traitées.' : undefined}
          />
        ) : (
          <>
            <DataTable columns={columns} data={lignes} />
            <Pagination meta={meta} onChange={setPage} />
          </>
        )}

      {cible && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setCible(null)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-1 text-lg font-bold text-gray-800">Justifier cette valeur</h2>
            <p className="mb-4 text-xs text-gray-500">{cible.message}</p>
            <Field label="Ce qui l’explique" required>
              <Textarea rows={3} value={motif} onChange={(e) => setMotif(e.target.value)}
                placeholder="Compteur horaire remplacé le 12/08, index reparti de zéro." />
            </Field>
            <p className="mt-2 text-[11px] text-gray-400">
              Ce texte est relu lors des contrôles : il doit suffire à comprendre sans rouvrir la fiche.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setCible(null)}>Annuler</Button>
              <Button type="button" icon={CheckCircle2} loading={busy === cible.id}
                disabled={!motif.trim()} onClick={() => traiter(cible, 'JUSTIFIEE', motif)}>
                Justifier
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * `useSearchParams` force le rendu côté client : sans cette frontière, la
 * compilation de production échoue à la prégénération de la page (elle passe
 * en développement et à la vérification de types - seul `next build` le voit).
 */
export default function AnomaliesSaisiePage() {
  return (
    <Suspense fallback={<TableSkeleton cols={7} />}>
      <AnomaliesSaisieEcran />
    </Suspense>
  );
}
