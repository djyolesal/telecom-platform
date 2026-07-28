'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Network, WifiOff, Radio, ChevronRight, ChevronDown } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatCard } from '@/components/shared/StatCard';
import { Loading, ErrorState } from '@/components/shared/states';

interface SiteNode {
  id: string;
  nom: string;
  region: string;
  parentTransmissionId?: string | null;
}

interface Arbre { racine: SiteNode; taille: number }

/**
 * Volet Topologie : forêt des chaînes de transmission (site amont → sites aval),
 * avec l'état temps réel superposé — un site en coupure est marqué en rouge,
 * et sa chaîne aval en ambre (impact potentiel/hérité).
 */
export default function TopologiePage() {
  const [recherche, setRecherche] = useState('');

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
        <div className="ml-auto flex items-center gap-x-4 gap-y-1 text-xs text-gray-500">
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-[#C0392B]" /> En coupure</span>
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-[#E67E22]" /> Aval d'un site down</span>
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-[#0E7C6B]" /> En service</span>
        </div>
      </div>

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
        {fils.length > 0 && <span className="text-xs text-gray-400">{fils.length} aval</span>}
      </button>
      {fils.map((e) => (
        <Noeud key={e.id} site={e} enfants={enfants} sitesDown={sitesDown} sitesImpactes={sitesImpactes} terme={terme} profondeur={profondeur + 1} />
      ))}
    </div>
  );
}
