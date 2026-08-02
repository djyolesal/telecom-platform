'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Network, WifiOff, Radio, ChevronRight, ChevronDown, Upload, X, CheckCircle2, AlertTriangle, ZoomIn, ZoomOut, Maximize2, ImageDown } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatCard } from '@/components/shared/StatCard';
import { Button } from '@/components/shared/Button';
import { ExportButtons } from '@/components/shared/ExportButtons';
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
  const [vue, setVue] = useState<'graphe' | 'liste'>('graphe');
  const [showImport, setShowImport] = useState(false);
  const { data: session } = useSession();
  const peutImporter = ['ADMIN', 'NOC'].includes((session?.user as { role?: string })?.role ?? '');
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

  const { enfants, arbres, nbLiaisons, sitesDown, sitesImpactes, liaisonsCritiques } = useMemo(() => {
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

    // Liaisons critiques (SPOF) : poids = le site + tout ce qui est suspendu à
    // sa liaison amont — les plus lourdes, surtout en FH, sont candidates à
    // une sécurisation (bouclage fibre, lien de secours).
    const liaisonsCritiques = tous
      .filter((s) => s.parentTransmissionId && parId.has(s.parentTransmissionId))
      .map((s) => ({ site: s, parent: parId.get(s.parentTransmissionId!)!, poids: 1 + taille(s.id) }))
      .sort((a, b) => b.poids - a.poids)
      .slice(0, 8);

    return { enfants, arbres, nbLiaisons, sitesDown, sitesImpactes, liaisonsCritiques };
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
        {/* Basculement de représentation : schéma de réseau ou arborescence textuelle. */}
        <div className="flex overflow-hidden rounded-lg border border-gray-200 bg-white text-sm font-medium">
          {(['graphe', 'liste'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVue(v)}
              className={`px-3 py-2 ${vue === v ? 'bg-[#1B3F6B] text-white' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              {v === 'graphe' ? 'Graphe' : 'Liste'}
            </button>
          ))}
        </div>
        {peutImporter && (
          <button
            type="button"
            onClick={() => setShowImport(true)}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <Upload size={15} /> Importer la topologie
          </button>
        )}
        {/* Excel ré-importable (colonnes site/parent/type) + PDF tabulaire. */}
        <ExportButtons base="/sites/topologie/export" name="topologie" />
        <div className="ml-auto flex items-center gap-x-4 gap-y-1 text-xs text-gray-500">
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-[#C0392B]" /> En coupure</span>
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-[#E67E22]" /> Aval d'un site down</span>
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-[#0E7C6B]" /> En service</span>
        </div>
      </div>

      {/* Liaisons critiques : les points de défaillance uniques les plus lourds. */}
      {liaisonsCritiques.length > 0 && (
        <div className="mb-4 rounded-xl border border-gray-100 bg-white p-4">
          <h3 className="mb-1 text-sm font-semibold text-gray-700">Liaisons critiques (points de défaillance uniques)</h3>
          <p className="mb-3 text-xs text-gray-400">
            Nombre de sites suspendus à chaque liaison amont — les plus lourdes en <b>FH</b> sont candidates à une sécurisation (bouclage fibre, lien de secours).
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                <th className="py-1.5 pr-4 font-medium">Liaison</th>
                <th className="px-3 py-1.5 font-medium">Type</th>
                <th className="px-3 py-1.5 text-right font-medium">Sites suspendus</th>
                <th className="px-3 py-1.5 font-medium"></th>
              </tr></thead>
              <tbody>
                {liaisonsCritiques.map(({ site, parent, poids }) => {
                  const familleFH = typesLiaisonParCode.get(site.typeLiaison ?? '')?.famille === 'FH';
                  return (
                    <tr key={site.id} className="border-b border-gray-50 last:border-0">
                      <td className="py-1.5 pr-4 font-medium text-gray-800">{parent.nom} → {site.nom}</td>
                      <td className="px-3 py-1.5">
                        {site.typeLiaison ? (
                          <span className="rounded px-1.5 py-px text-[10px] font-bold text-white" style={{ backgroundColor: couleurLiaison(site.typeLiaison) }}>
                            {site.typeLiaison}
                          </span>
                        ) : <span className="text-xs text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{poids}</td>
                      <td className="px-3 py-1.5">
                        {familleFH && poids >= 5 && (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">FH — à sécuriser</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
            <ArbreCard key={a.racine.id} arbre={a} enfants={enfants} sitesDown={sitesDown} sitesImpactes={sitesImpactes} terme={terme} vue={vue} />
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

function ArbreCard({ arbre, enfants, sitesDown, sitesImpactes, terme, vue }: {
  arbre: Arbre;
  enfants: Map<string, SiteNode[]>;
  sitesDown: Set<string>;
  sitesImpactes: Set<string>;
  terme: string;
  vue: 'graphe' | 'liste';
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
          {vue === 'graphe' ? (
            <GrapheChaine racine={arbre.racine} enfants={enfants} sitesDown={sitesDown} sitesImpactes={sitesImpactes} terme={terme} />
          ) : (
            <Noeud site={arbre.racine} enfants={enfants} sitesDown={sitesDown} sitesImpactes={sitesImpactes} terme={terme} profondeur={0} />
          )}
        </div>
      )}
    </div>
  );
}

// ── Vue graphe : schéma de réseau SVG (racine à gauche, aval vers la droite) ─

const G = { colW: 200, rowH: 36, nodeW: 158, nodeH: 26 };

/**
 * Disposition « tidy tree » : chaque feuille occupe une rangée, chaque parent
 * se centre sur ses enfants. Résultat : positions (colonne, rangée) par site.
 */
function layoutChaine(racine: SiteNode, enfants: Map<string, SiteNode[]>) {
  const pos = new Map<string, { x: number; y: number }>();
  const ordre: SiteNode[] = [];
  let rangee = 0;
  let maxProfondeur = 0;
  const visites = new Set<string>();
  const walk = (site: SiteNode, profondeur: number): number => {
    if (visites.has(site.id)) return rangee; // garde-fou (les cycles sont refusés côté serveur)
    visites.add(site.id);
    ordre.push(site);
    maxProfondeur = Math.max(maxProfondeur, profondeur);
    const fils = enfants.get(site.id) ?? [];
    let y: number;
    if (fils.length === 0) {
      y = rangee++;
    } else {
      const ys = fils.map((f) => walk(f, profondeur + 1));
      y = (Math.min(...ys) + Math.max(...ys)) / 2;
    }
    pos.set(site.id, { x: profondeur, y });
    return y;
  };
  walk(racine, 0);
  return { pos, ordre, rangees: Math.max(rangee, 1), colonnes: maxProfondeur + 1 };
}

function GrapheChaine({ racine, enfants, sitesDown, sitesImpactes, terme }: {
  racine: SiteNode;
  enfants: Map<string, SiteNode[]>;
  sitesDown: Set<string>;
  sitesImpactes: Set<string>;
  terme: string;
}) {
  const router = useRouter();
  const { pos, ordre, rangees, colonnes } = useMemo(() => layoutChaine(racine, enfants), [racine, enfants]);
  const largeur = (colonnes - 1) * G.colW + G.nodeW + 16;
  const hauteur = rangees * G.rowH + 8;
  const cx = (p: { x: number; y: number }) => p.x * G.colW + 8;
  const cy = (p: { x: number; y: number }) => p.y * G.rowH + 4 + (G.rowH - G.nodeH) / 2;

  // Zoom : boutons +/−/Ajuster, et molette avec Ctrl/⌘ (le SVG reste net, il est vectoriel).
  const [zoom, setZoom] = useState(1);
  const boxRef = useRef<HTMLDivElement>(null);
  const clamp = (z: number) => Math.min(2.5, Math.max(0.15, z));

  // Déplacement à la souris (cliquer-glisser = défilement du cadre). On mémorise
  // la distance parcourue pour qu'un glissement ne déclenche PAS le clic-fiche.
  const drag = useRef({ actif: false, x: 0, y: 0, sx: 0, sy: 0, distance: 0 });
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = boxRef.current;
    if (!el || e.button !== 0) return;
    drag.current = { actif: true, x: e.clientX, y: e.clientY, sx: el.scrollLeft, sy: el.scrollTop, distance: 0 };
    el.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = boxRef.current;
    if (!el || !drag.current.actif) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    drag.current.distance = Math.max(drag.current.distance, Math.abs(dx) + Math.abs(dy));
    el.scrollLeft = drag.current.sx - dx;
    el.scrollTop = drag.current.sy - dy;
  };
  const onPointerUp = () => { drag.current.actif = false; };
  const clicApresGlissement = () => drag.current.distance > 5;

  // Export PNG : le SVG est sérialisé puis rendu sur un canvas (fond blanc).
  // L'échelle est plafonnée pour que les très grandes chaînes (plusieurs
  // centaines de sites) restent dans les limites de taille d'un canvas.
  const svgRef = useRef<SVGSVGElement>(null);
  const exporterPng = () => {
    const svg = svgRef.current;
    if (!svg) return;
    const echelle = Math.min(2, 8000 / largeur, 8000 / hauteur);
    const xml = new XMLSerializer().serializeToString(svg);
    const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(largeur * echelle);
      canvas.height = Math.round(hauteur * echelle);
      const ctx = canvas.getContext('2d');
      if (!ctx) { URL.revokeObjectURL(url); return; }
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => {
        if (!b) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = `topologie-${racine.nom}.png`;
        a.click();
        URL.revokeObjectURL(a.href);
      }, 'image/png');
    };
    img.src = url;
  };
  const ajuster = () => {
    const w = boxRef.current?.clientWidth;
    if (w) setZoom(clamp((w - 20) / largeur));
  };
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    // addEventListener explicite : le onWheel React est passif et ne peut pas
    // bloquer le zoom navigateur (preventDefault y est ignoré).
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => clamp(z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-end gap-1 text-xs text-gray-500">
        <span className="mr-1 hidden sm:inline">Ctrl + molette pour zoomer</span>
        <button type="button" onClick={() => setZoom((z) => clamp(z / 1.25))} title="Réduire"
          className="rounded-md border border-gray-200 bg-white p-1.5 text-gray-600 hover:bg-gray-50">
          <ZoomOut size={14} />
        </button>
        <span className="w-11 text-center font-medium tabular-nums">{Math.round(zoom * 100)} %</span>
        <button type="button" onClick={() => setZoom((z) => clamp(z * 1.25))} title="Agrandir"
          className="rounded-md border border-gray-200 bg-white p-1.5 text-gray-600 hover:bg-gray-50">
          <ZoomIn size={14} />
        </button>
        <button type="button" onClick={ajuster} title="Ajuster la chaîne à la largeur"
          className="rounded-md border border-gray-200 bg-white p-1.5 text-gray-600 hover:bg-gray-50">
          <Maximize2 size={14} />
        </button>
        <button type="button" onClick={() => setZoom(1)} title="Taille réelle"
          className="rounded-md border border-gray-200 bg-white px-2 py-1 font-medium text-gray-600 hover:bg-gray-50">
          100 %
        </button>
        <button type="button" onClick={exporterPng} title="Télécharger cette chaîne en image PNG"
          className="ml-1 flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 font-medium text-gray-600 hover:bg-gray-50">
          <ImageDown size={14} /> PNG
        </button>
      </div>
      <div
        ref={boxRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="max-h-[70vh] cursor-grab touch-pan-x touch-pan-y select-none overflow-auto rounded-lg bg-gray-50/60 p-2 active:cursor-grabbing"
      >
        <svg ref={svgRef} viewBox={`0 0 ${largeur} ${hauteur}`} width={largeur * zoom} height={hauteur * zoom} className="block">
        {/* Arêtes parent → enfant, colorées selon le type de liaison de l'ENFANT. */}
        {ordre.map((s) => {
          if (s.id === racine.id) return null;
          const pp = s.parentTransmissionId ? pos.get(s.parentTransmissionId) : undefined;
          const pe = pos.get(s.id);
          if (!pp || !pe) return null;
          const x1 = cx(pp) + G.nodeW, y1 = cy(pp) + G.nodeH / 2;
          const x2 = cx(pe), y2 = cy(pe) + G.nodeH / 2;
          const mi = (x1 + x2) / 2;
          const enDefaut = sitesDown.has(s.id) || sitesImpactes.has(s.id);
          return (
            <path
              key={`e-${s.id}`}
              d={`M ${x1} ${y1} C ${mi} ${y1}, ${mi} ${y2}, ${x2} ${y2}`}
              fill="none"
              stroke={couleurLiaison(s.typeLiaison)}
              strokeWidth={1.6}
              strokeDasharray={enDefaut ? '4 3' : undefined}
              opacity={0.85}
            >
              <title>{`${s.nom} ← liaison ${s.typeLiaison ?? 'non renseignée'}`}</title>
            </path>
          );
        })}
        {/* Nœuds : pastille d'état + nom, clic → fiche site. */}
        {ordre.map((s) => {
          const p = pos.get(s.id)!;
          const x = cx(p), y = cy(p);
          const down = sitesDown.has(s.id);
          const impacte = !down && sitesImpactes.has(s.id);
          const surligne = terme && s.nom.toLowerCase().includes(terme);
          const fond = down ? '#FDECEA' : impacte ? '#FEF5E7' : '#FFFFFF';
          const bord = down ? '#C0392B' : impacte ? '#E67E22' : surligne ? '#2471A3' : '#D5DBDB';
          return (
            <g
              key={s.id}
              onClick={() => { if (!clicApresGlissement()) router.push(`/sites/${s.id}`); }}
              className="cursor-pointer"
            >
              <rect x={x} y={y} width={G.nodeW} height={G.nodeH} rx={13}
                fill={fond} stroke={bord} strokeWidth={surligne ? 2 : 1.2} />
              <circle cx={x + 13} cy={y + G.nodeH / 2} r={4}
                fill={down ? '#C0392B' : impacte ? '#E67E22' : '#0E7C6B'} />
              <text x={x + 24} y={y + G.nodeH / 2 + 3.5} fontSize={11.5} fontWeight={600}
                fill={down ? '#922B21' : impacte ? '#9C640C' : '#2C3E50'}>
                {s.nom.length > 18 ? `${s.nom.slice(0, 17)}…` : s.nom}
              </text>
              <title>{`${s.nom} · ${s.region}${s.typeLiaison ? ` · liaison ${s.typeLiaison}` : ''}${down ? ' — EN COUPURE' : impacte ? " — aval d'un site en coupure" : ''}`}</title>
            </g>
          );
        })}
        </svg>
      </div>
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
