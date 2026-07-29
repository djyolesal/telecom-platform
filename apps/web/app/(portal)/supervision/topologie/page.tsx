'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Network, WifiOff, Radio, ChevronRight, ChevronDown, Upload, X, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatCard } from '@/components/shared/StatCard';
import { Button } from '@/components/shared/Button';
import { Loading, ErrorState } from '@/components/shared/states';
import { couleurLiaison, useTypesLiaison } from '@/lib/liaisons';

interface SiteNode {
  id: string;
  nom: string;
  region: string;
  parentTransmissionId?: string | null;
  typeLiaison?: string | null;
}

interface Arbre { racine: SiteNode; taille: number }

/**
 * Volet Topologie : forêt des chaînes de transmission (site amont → sites aval),
 * avec l'état temps réel superposé — un site en coupure est marqué en rouge,
 * et sa chaîne aval en ambre (impact potentiel/hérité).
 */
export default function TopologiePage() {
  const [recherche, setRecherche] = useState('');
  const [showImport, setShowImport] = useState(false);
  const { data: session } = useSession();
  const peutImporter = ((session?.user as { role?: string })?.role ?? '') === 'ADMIN';
  const queryClient = useQueryClient();
  const { parCode: typesLiaisonParCode } = useTypesLiaison();

  const { data: sites, isLoading, isError } = useQuery({
    queryKey: ['sites-all'],
    queryFn: () => api.get('/sites', { params: { all: 'true' } }).then((r) => r.data.data as SiteNode[]),
    staleTime: 5 * 60_000,
  });

  // Coupures EN COURS → sites marqués « down" sur le graphe.
  const { data: coupures } = useQuery({
    queryKey: ['coupures-en-cours-topo'],
    queryFn: () => api.get('/coupures-reseau', { params: { statut: 'EN_COURS', limit: 200 } })
      .then((r) => r.data.data as { siteId?: string; site?: { nom: string } }[]),
    refetchInterval: 60_000,
  });

  const { enfants, arbres, nbLiaisons, sitesDown, sitesImpactes } = useMemo(() => {
    const tous = sites ?? [];
    const enfants = new Map<string, SiteNode[]>();
    const parId = new Map(tous.map((s) => [s.id, s]));
    let nbLiaisons = 0;
    for (const s of tous) {
      if (!s.parentTransmissionId || !parId.has(s.parentTransmissionId)) continue;
      nbLiaisons++;
      const liste = enfants.get(s.parentTransmissionId) ?? [];
      liste.push(s);
      enfants.set(s.parentTransmissionId, liste);
    }
    enfants.forEach((l) => l.sort((a, b) => a.nom.localeCompare(b.nom)));

    // Racines des arbres : sites SANS parent qui ont de l'aval.
    const taille = (id: string): number =>
      (enfants.get(id) ?? []).reduce((n, e) => n + 1 + taille(e.id), 0);
    const arbres: Arbre[] = tous
      .filter((s) => (!s.parentTransmissionId || !parId.has(s.parentTransmissionId)) && enfants.has(s.id))
      .map((s) => ({ racine: s, taille: 1 + taille(s.id) }))
      .sort((a, b) => b.taille - a.taille);

    // Sites en coupure (rouge) et leur aval (ambre).
    const sitesDown = new Set((coupures ?? []).map((c) => c.siteId).filter((x): x is string => !!x));
    const sitesImpactes = new Set<string>();
    const marquerAval = (id: string) => {
      for (const e of enfants.get(id) ?? []) {
        if (!sitesImpactes.has(e.id)) { sitesImpactes.add(e.id); marquerAval(e.id); }
      }
    };
    sitesDown.forEach(marquerAval);

    return { enfants, arbres, nbLiaisons, sitesDown, sitesImpactes };
  }, [sites, coupures]);

  // Comptage des liaisons déclarées par type (seuls les sites AVEC parent comptent).
  const repartitionTypes = useMemo(() => {
    const compte = new Map<string, number>();
    for (const s of sites ?? []) {
      if (s.typeLiaison && s.parentTransmissionId) compte.set(s.typeLiaison, (compte.get(s.typeLiaison) ?? 0) + 1);
    }
    return [...compte.entries()].sort((a, b) => b[1] - a[1]);
  }, [sites]);

  if (isLoading) return <Loading />;
  if (isError || !sites) return <ErrorState message="Topologie indisponible" />;

  const terme = recherche.trim().toLowerCase();
  const arbreContient = (id: string): boolean => {
    const s = (sites ?? []).find((x) => x.id === id);
    if (s && s.nom.toLowerCase().includes(terme)) return true;
    return (enfants.get(id) ?? []).some((e) => arbreContient(e.id));
  };
  const arbresVisibles = terme ? arbres.filter((a) => arbreContient(a.racine.id)) : arbres;
  const nbDirectsSansAval = sites.length - nbLiaisons - arbres.length;

  return (
    <div>
      <PageHeader
        title="Topologie de transmission"
        subtitle="Chaînes site amont → sites aval, avec l'état des coupures en temps réel"
      />

      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard title="Chaînes" value={arbres.length} subtitle="arbres de transmission" icon={Network} color="bg-[#1B3F6B]" />
        <StatCard title="Liaisons déclarées" value={nbLiaisons} subtitle={`${nbDirectsSansAval} sites directs sans aval`} icon={Radio} color="bg-[#0E7C6B]" />
        <StatCard title="Sites en coupure" value={sitesDown.size} subtitle="coupures en cours" icon={WifiOff} color="bg-[#C0392B]" />
        <StatCard title="Aval sous menace" value={sitesImpactes.size} subtitle="dépendants d'un site down" icon={WifiOff} color="bg-[#E67E22]" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          placeholder="Rechercher un site dans les chaînes…"
          className="w-72 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#2471A3]"
        />
        {peutImporter && (
          <button
            type="button"
            onClick={() => setShowImport(true)}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <Upload size={15} /> Importer la topologie
          </button>
        )}
        <div className="ml-auto flex items-center gap-x-4 gap-y-1 text-xs text-gray-500">
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-[#C0392B]" /> En coupure</span>
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-[#E67E22]" /> Aval d'un site down</span>
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-[#0E7C6B]" /> En service</span>
        </div>
      </div>

      {/* Répartition des liaisons déclarées par type (FIBER / TN / ML / RTN…). */}
      {repartitionTypes.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-gray-500">Liaisons par type :</span>
          {repartitionTypes.map(([code, n]) => (
            <span
              key={code}
              className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 font-medium text-gray-700"
              title={typesLiaisonParCode.get(code)?.libelle ?? code}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: couleurLiaison(code) }} />
              {code} · {n}
            </span>
          ))}
        </div>
      )}

      {arbres.length === 0 ? (
        <div className="rounded-xl border border-gray-100 bg-white p-10 text-center">
          <Network size={32} className="mx-auto mb-3 text-gray-200" />
          <p className="text-sm text-gray-500">Aucune liaison de transmission déclarée pour l'instant.</p>
          <p className="mt-1 text-xs text-gray-400">
            Déclarez le site amont de chaque site dépendant : fiche du site → Modifier → « Site parent (transmission) ».
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {arbresVisibles.map((a) => (
            <ArbreCard key={a.racine.id} arbre={a} enfants={enfants} sitesDown={sitesDown} sitesImpactes={sitesImpactes} terme={terme} />
          ))}
          {arbresVisibles.length === 0 && (
            <div className="rounded-xl border border-gray-100 bg-white p-8 text-center text-sm text-gray-400">
              Aucune chaîne ne contient « {recherche} ».
            </div>
          )}
        </div>
      )}

      {showImport && (
        <ImportTopologieModal
          onClose={() => setShowImport(false)}
          onDone={() => queryClient.invalidateQueries({ queryKey: ['sites-all'] })}
        />
      )}
    </div>
  );
}

// ── Import de la topologie (fichier NOC : site / parent / type) ─────────────

interface ImportTopoResult {
  liaisons: number;
  sitesIntrouvables: string[];
  parentsIntrouvables: string[];
  lignesIncompletes: number;
  cyclesIgnores: string[];
}

function ImportTopologieModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const mutation = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append('file', file as File);
      const r = await api.post('/sites/import-topologie', form);
      return r.data.data as ImportTopoResult;
    },
    onSuccess: onDone,
  });
  const result = mutation.data;
  const errMsg = (mutation.error as { response?: { data?: { error?: string } } } | null)?.response?.data?.error;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-semibold text-gray-800">
            <Network size={17} className="text-[#1B3F6B]" /> Importer la topologie
          </h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <p className="mb-3 text-sm text-gray-600">
          Fichier <b>.xlsx</b> avec les colonnes <code className="text-xs">site</code>, <code className="text-xs">parent</code> et{' '}
          <code className="text-xs">type</code> (FIBER, TN, ML, RTN…). Ré-importer met à jour les liaisons existantes,
          les cycles sont refusés ligne par ligne.
        </p>
        <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="mb-3 block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-[#1B3F6B] file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-[#16345a]" />
        {errMsg && <p className="mb-2 text-sm text-red-600">{errMsg}</p>}
        {result && (
          <div className="mb-3 rounded-lg bg-gray-50 p-3 text-sm">
            <p className="flex items-center gap-1.5 font-medium text-emerald-700">
              <CheckCircle2 size={15} /> {result.liaisons} liaison(s) enregistrée(s)
              {result.lignesIncompletes > 0 && ` · ${result.lignesIncompletes} ligne(s) incomplète(s) ignorée(s)`}
            </p>
            {result.sitesIntrouvables.length > 0 && (
              <div className="mt-2 text-amber-700">
                <p className="flex items-center gap-1.5 font-medium"><AlertTriangle size={14} /> Sites non reconnus ({result.sitesIntrouvables.length}) :</p>
                <p className="mt-1 text-xs">{result.sitesIntrouvables.slice(0, 12).join(' · ')}{result.sitesIntrouvables.length > 12 ? ' …' : ''}</p>
              </div>
            )}
            {result.parentsIntrouvables.length > 0 && (
              <div className="mt-2 text-amber-700">
                <p className="flex items-center gap-1.5 font-medium"><AlertTriangle size={14} /> Parents non reconnus ({result.parentsIntrouvables.length}) :</p>
                <p className="mt-1 text-xs">{result.parentsIntrouvables.slice(0, 12).join(' · ')}{result.parentsIntrouvables.length > 12 ? ' …' : ''}</p>
              </div>
            )}
            {result.cyclesIgnores.length > 0 && (
              <p className="mt-2 text-xs text-red-600">Cycles refusés : {result.cyclesIgnores.join(', ')}</p>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
            {result ? 'Fermer' : 'Annuler'}
          </button>
          {!result && (
            <Button onClick={() => mutation.mutate()} disabled={!file || mutation.isPending}>
              {mutation.isPending ? 'Import en cours…' : 'Importer'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function ArbreCard({ arbre, enfants, sitesDown, sitesImpactes, terme }: {
  arbre: Arbre;
  enfants: Map<string, SiteNode[]>;
  sitesDown: Set<string>;
  sitesImpactes: Set<string>;
  terme: string;
}) {
  const [ouvert, setOuvert] = useState(true);
  const touche = sitesDown.has(arbre.racine.id) || [...sitesImpactes].some((id) => sousArbreContientId(arbre.racine.id, id, enfants));
  return (
    <div className={`rounded-xl border bg-white ${touche ? 'border-red-200' : 'border-gray-100'}`}>
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
      >
        {ouvert ? <ChevronDown size={15} className="text-gray-400" /> : <ChevronRight size={15} className="text-gray-400" />}
        <span className="text-sm font-semibold text-gray-800">Chaîne {arbre.racine.nom}</span>
        <span className="text-xs text-gray-400">{arbre.taille} sites</span>
        {touche && <span className="ml-auto rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700">coupure dans la chaîne</span>}
      </button>
      {ouvert && (
        <div className="px-4 pb-4">
          <Noeud site={arbre.racine} enfants={enfants} sitesDown={sitesDown} sitesImpactes={sitesImpactes} terme={terme} profondeur={0} />
        </div>
      )}
    </div>
  );
}

function sousArbreContientId(racineId: string, chercheId: string, enfants: Map<string, SiteNode[]>): boolean {
  if (racineId === chercheId) return true;
  return (enfants.get(racineId) ?? []).some((e) => sousArbreContientId(e.id, chercheId, enfants));
}

function Noeud({ site, enfants, sitesDown, sitesImpactes, terme, profondeur }: {
  site: SiteNode;
  enfants: Map<string, SiteNode[]>;
  sitesDown: Set<string>;
  sitesImpactes: Set<string>;
  terme: string;
  profondeur: number;
}) {
  const router = useRouter();
  const fils = enfants.get(site.id) ?? [];
  const down = sitesDown.has(site.id);
  const impacte = !down && sitesImpactes.has(site.id);
  const surligne = terme && site.nom.toLowerCase().includes(terme);

  return (
    <div className={profondeur > 0 ? 'ml-4 border-l-2 border-gray-100 pl-4' : ''}>
      <button
        type="button"
        onClick={() => router.push(`/sites/${site.id}`)}
        className={`my-1 inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 text-sm transition-colors ${
          down ? 'border-red-200 bg-red-50 text-red-800'
          : impacte ? 'border-amber-200 bg-amber-50 text-amber-800'
          : 'border-gray-200 bg-gray-50 text-gray-700 hover:bg-[#EAF1F8]'
        } ${surligne ? 'ring-2 ring-[#2471A3]' : ''}`}
        title={`${site.nom} · ${site.region}${down ? ' — EN COUPURE' : impacte ? ' — aval d’un site en coupure' : ''}`}
      >
        <span className={`h-2 w-2 rounded-full ${down ? 'bg-[#C0392B]' : impacte ? 'bg-[#E67E22]' : 'bg-[#0E7C6B]'}`} />
        <span className="font-medium">{site.nom}</span>
        {site.typeLiaison && profondeur > 0 && (
          <span
            className="rounded px-1 py-px text-[10px] font-bold text-white"
            style={{ backgroundColor: couleurLiaison(site.typeLiaison) }}
            title={`Liaison vers l'amont : ${site.typeLiaison}`}
          >
            {site.typeLiaison}
          </span>
        )}
        {fils.length > 0 && <span className="text-xs text-gray-400">{fils.length} aval</span>}
      </button>
      {fils.map((e) => (
        <Noeud key={e.id} site={e} enfants={enfants} sitesDown={sitesDown} sitesImpactes={sitesImpactes} terme={terme} profondeur={profondeur + 1} />
      ))}
    </div>
  );
}
