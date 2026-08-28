'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { Loading } from '@/components/shared/states';
import { Select } from '@/components/shared/Form';
import { useSupervisionSocket } from '@/lib/hooks/useSupervisionSocket';
import type { SiteFeature, EtatReseau, Liaison } from '@/components/maps/SitesMap';
import { COULEUR_MULTI_CAMIONS, PALETTE_CAMIONS } from '@/components/maps/couleursCamions';
import { couleurLiaison, useTypesLiaison } from '@/lib/liaisons';

// Couleur d'un site/liaison selon son état réseau (mode topologie « par état »).
const ETAT_COULEUR: Record<string, string> = { DOWN: '#C0392B', PARTIEL: '#E67E22', IMPACTE: '#8E44AD', OK: '#0E7C6B' };
const ETAT_LABEL: Record<string, string> = { DOWN: 'entièrement coupé', PARTIEL: 'coupure partielle', IMPACTE: 'aval menacé', OK: 'en service' };

// Leaflet ne supporte pas le SSR → import dynamique côté client uniquement
const SitesMap = dynamic(() => import('@/components/maps/SitesMap').then((m) => m.SitesMap), {
  ssr: false,
  loading: () => <Loading label="Chargement de la carte…" />,
});

const STATUT_OPTIONS = [
  { value: 'GE_PERMANENT', label: 'GE permanent' },
  { value: 'GE_SECOURS', label: 'GE secours' },
  { value: 'PAS_DE_GE', label: 'Pas de GE' },
];
const STOCK_OPTIONS = [
  { value: 'critique', label: 'Stock critique / vide' },
  { value: 'faible', label: 'Stock faible' },
  { value: 'ok', label: 'Stock OK' },
];

export default function CartePage() {
  useSupervisionSocket();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role ?? '';
  const [region, setRegion] = useState('');
  const [statut, setStatut] = useState('');
  const [stock, setStock] = useState('');
  // Trois lectures de la même carte : STOCK (logistique carburant), RÉSEAU
  // (coupures + aval menacé - la question du NOC) et TOPOLOGIE (l'arbre de
  // transmission tracé géographiquement). Défaut selon le rôle.
  const [modeChoisi, setModeChoisi] = useState<'stock' | 'reseau' | 'topologie' | null>(null);
  const mode = modeChoisi ?? (role === 'NOC' ? 'reseau' : 'stock');
  // Filtre d'état en mode réseau : isoler les coupés, partiels ou menacés.
  const [etatReseauFiltre, setEtatReseauFiltre] = useState('');
  // Mode topologie : coloration des liaisons par TYPE (défaut) ou par ÉTAT.
  const [colorationTopo, setColorationTopo] = useState<'type' | 'etat'>('type');
  const { liste: typesLiaisonListe, parCode: typesLiaisonParCode } = useTypesLiaison();

  const { data, isLoading } = useQuery({
    queryKey: ['sites-geojson'],
    queryFn: () => api.get('/sites/geojson').then((r) => r.data),
  });

  const all: SiteFeature[] = useMemo(() => data?.features ?? [], [data]);
  // Vue transporteur : l'API ne sert que SES sites à livrer, sans stock ni
  // statut GE - les filtres et la légende d'exploitation n'ont pas de sens.
  const vueLivraison = data?.vue === 'transporteur';
  const [camion, setCamion] = useState('');

  // ── Modes réseau & topologie : coupures en cours + arbre de transmission ──
  const modeReseau = mode === 'reseau' && !vueLivraison;
  const modeTopo = mode === 'topologie' && !vueLivraison;
  const besoinReseau = modeReseau || modeTopo;
  const { data: coupures } = useQuery({
    queryKey: ['coupures-en-cours-carte'],
    queryFn: () => api.get('/coupures-reseau', { params: { statut: 'EN_COURS', limit: 200 } })
      .then((r) => r.data.data as { siteId?: string; technologie?: string }[]),
    enabled: besoinReseau,
    refetchInterval: 300_000,
  });
  const { data: liens } = useQuery({
    queryKey: ['sites-all'],
    queryFn: () => api.get('/sites', { params: { all: true } })
      .then((r) => r.data.data as { id: string; parentTransmissionId?: string | null; typeLiaison?: string | null }[]),
    enabled: besoinReseau,
    // La topologie bouge rarement : 10 min de cache évitent de recharger
    // 558 sites à chaque montage de la carte.
    staleTime: 10 * 60_000,
  });
  const etatReseauParSite = useMemo(() => {
    if (!besoinReseau) return undefined;
    const enfants = new Map<string, string[]>();
    for (const s of liens ?? []) {
      if (s.parentTransmissionId) enfants.set(s.parentTransmissionId, [...(enfants.get(s.parentTransmissionId) ?? []), s.id]);
    }
    const technos = new Map<string, Set<string>>();
    for (const c of coupures ?? []) {
      if (!c.siteId) continue;
      const t = technos.get(c.siteId) ?? new Set<string>();
      t.add(c.technologie ?? 'SITE');
      technos.set(c.siteId, t);
    }
    // Coupure TOTALE (SITE ou toutes les technos) vs PARTIELLE (une partie) :
    // un site qui a perdu sa 3G n'est pas un site mort - même règle de
    // propagation que la topologie : seul un site ENTIÈREMENT down menace l'aval.
    const entierementDown = (id: string) => {
      const t = technos.get(id);
      return !!t && (t.has('SITE') || ['2G', '3G', '4G', '5G'].every((x) => t.has(x)));
    };
    const etat: Record<string, EtatReseau> = {};
    for (const [id, t] of technos) {
      etat[id] = { etat: entierementDown(id) ? 'DOWN' : 'PARTIEL', note: [...t].join('/') };
    }
    const marquerAval = (id: string) => {
      for (const e of enfants.get(id) ?? []) {
        if (!etat[e]) { etat[e] = { etat: 'IMPACTE' }; marquerAval(e); }
      }
    };
    for (const id of technos.keys()) if (entierementDown(id)) marquerAval(id);
    return etat;
  }, [besoinReseau, coupures, liens]);

  // ── Mode topologie : liaisons enfant → parent tracées sur la carte ──
  const liaisons = useMemo<Liaison[] | undefined>(() => {
    if (!modeTopo) return undefined;
    // Coordonnées et région par site depuis le GeoJSON (source des positions).
    const coord = new Map<string, [number, number]>();
    const nomDe = new Map<string, string>();
    const regionDe = new Map<string, string>();
    for (const f of all) {
      coord.set(f.properties.id, [f.geometry.coordinates[1], f.geometry.coordinates[0]]);
      nomDe.set(f.properties.id, f.properties.nom);
      regionDe.set(f.properties.id, f.properties.region);
    }
    const out: Liaison[] = [];
    for (const s of liens ?? []) {
      const parent = s.parentTransmissionId;
      if (!parent) continue;
      const a = coord.get(s.id); const b = coord.get(parent);
      if (!a || !b) continue; // un site sans coordonnées ne se trace pas
      // Filtre région : on garde la liaison si l'enfant est dans la région.
      if (region && regionDe.get(s.id) !== region) continue;
      const type = typesLiaisonParCode.get(s.typeLiaison ?? '');
      const etat = etatReseauParSite?.[s.id]?.etat ?? 'OK';
      out.push({
        id: s.id,
        from: a,
        to: b,
        couleur: colorationTopo === 'type' ? couleurLiaison(s.typeLiaison) : ETAT_COULEUR[etat],
        enfant: nomDe.get(s.id) ?? s.id,
        parent: nomDe.get(parent) ?? parent,
        typeLabel: type?.libelle ?? s.typeLiaison ?? 'Liaison',
        etatLabel: ETAT_LABEL[etat],
        pointille: type?.famille === 'FH',
      });
    }
    return out;
  }, [modeTopo, all, liens, region, colorationTopo, typesLiaisonParCode, etatReseauParSite]);

  // Rôle topologique de chaque site sans parent : RACINE (tête de chaîne, il a
  // de l'aval) vs ISOLÉ (aucun aval → topologie souvent non renseignée).
  const { rolesTopo, nbRacines, nbIsoles } = useMemo(() => {
    if (!modeTopo) return { rolesTopo: undefined as Record<string, 'racine' | 'isole'> | undefined, nbRacines: 0, nbIsoles: 0 };
    const aDeLaval = new Set<string>();
    for (const s of liens ?? []) if (s.parentTransmissionId) aDeLaval.add(s.parentTransmissionId);
    const roles: Record<string, 'racine' | 'isole'> = {};
    let racines = 0, isoles = 0;
    for (const s of liens ?? []) {
      if (s.parentTransmissionId) continue; // a un amont → ni racine ni isolé
      if (aDeLaval.has(s.id)) { roles[s.id] = 'racine'; racines++; }
      else { roles[s.id] = 'isole'; isoles++; }
    }
    return { rolesTopo: roles, nbRacines: racines, nbIsoles: isoles };
  }, [modeTopo, liens]);

  // Une couleur STABLE par camion (ordre alphabétique des plaques) : la même
  // plaque garde sa couleur d'un chargement à l'autre tant que la flotte en
  // tournée ne change pas - le chauffeur mémorise « mon camion = vert ».
  const camionsEnTournee = useMemo(
    () => [...new Set(all.flatMap((f) => f.properties.camions ?? []))].sort(),
    [all]
  );
  const couleurParCamion = useMemo(
    () => Object.fromEntries(camionsEnTournee.map((c, i) => [c, PALETTE_CAMIONS[i % PALETTE_CAMIONS.length]])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [camionsEnTournee]
  );

  // Régions présentes (pour le filtre).
  const regionOptions = useMemo(
    () => [...new Set(all.map((f) => f.properties.region).filter(Boolean))].sort().map((r) => ({ value: r, label: r })),
    [all]
  );

  const features = useMemo(
    () =>
      all.filter((f) => {
        if (camion && !(f.properties.camions ?? []).includes(camion)) return false;
        if (region && f.properties.region !== region) return false;
        if (statut && f.properties.statutGE !== statut) return false;
        if (stock) {
          const n = f.properties.niveauStock;
          if (stock === 'critique' && !(n === 'CRITIQUE' || n === 'VIDE')) return false;
          if (stock === 'faible' && n !== 'FAIBLE') return false;
          if (stock === 'ok' && n !== 'OK') return false;
        }
        if (etatReseauFiltre && etatReseauParSite) {
          const e = etatReseauParSite[f.properties.id]?.etat ?? 'OK';
          if (e !== etatReseauFiltre) return false;
        }
        return true;
      }),
    [all, region, statut, stock, camion, etatReseauFiltre, etatReseauParSite]
  );

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={vueLivraison ? 'Carte de mes livraisons' : 'Carte de supervision'}
        subtitle={vueLivraison
          ? `${all.length} site(s) à livrer selon vos plans en cours`
          : modeTopo
            ? `${liaisons?.length ?? 0} liaison(s) · ${nbRacines} racine(s) · ${nbIsoles} isolé(s) (topologie à compléter)`
            : modeReseau
            ? `${Object.values(etatReseauParSite ?? {}).filter((e) => e.etat === 'DOWN').length} coupé(s) · ${Object.values(etatReseauParSite ?? {}).filter((e) => e.etat === 'PARTIEL').length} partiel(s) · ${Object.values(etatReseauParSite ?? {}).filter((e) => e.etat === 'IMPACTE').length} aval menacé(s) · temps réel`
            : `${features.length} / ${all.length} sites · temps réel`}
      />

      <div className="flex flex-wrap items-center gap-3 mb-3">
        {vueLivraison && camionsEnTournee.length > 1 && (
          <div className="w-48">
            <Select value={camion} onChange={(e) => setCamion(e.target.value)} placeholder="Tous les camions"
              options={camionsEnTournee.map((c) => ({ value: c, label: c }))} />
          </div>
        )}
        {!vueLivraison && (<>
        {/* Bascule de lecture : Stock (logistique) / Réseau (coupures). Le NOC
            n'a PAS le mode Stock - la logistique carburant est hors de son
            périmètre, sa carte est toujours en lecture réseau. */}
        {/* Le NOC n'a pas le mode Stock (logistique hors périmètre) mais garde
            Réseau et Topologie. */}
        <div className="flex overflow-hidden rounded-lg border border-gray-200 bg-white text-sm font-medium">
          {(role === 'NOC' ? (['reseau', 'topologie'] as const) : (['stock', 'reseau', 'topologie'] as const)).map((m) => (
            <button key={m} type="button" onClick={() => setModeChoisi(m)}
              className={`px-3 py-2 ${mode === m ? 'bg-[#1B3F6B] text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
              {m === 'stock' ? 'Stock' : m === 'reseau' ? 'Réseau' : 'Topologie'}
            </button>
          ))}
        </div>
        {modeTopo && (
          <div className="flex overflow-hidden rounded-lg border border-gray-200 bg-white text-xs font-medium">
            <span className="px-2 py-2 text-gray-400">Liaisons&nbsp;:</span>
            {(['type', 'etat'] as const).map((c) => (
              <button key={c} type="button" onClick={() => setColorationTopo(c)}
                className={`px-3 py-2 ${colorationTopo === c ? 'bg-[#2471A3] text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
                {c === 'type' ? 'Par type' : 'Par état'}
              </button>
            ))}
          </div>
        )}
        <div className="w-44"><Select value={region} onChange={(e) => setRegion(e.target.value)} options={regionOptions} placeholder="Toutes régions" /></div>
        <div className="w-40"><Select value={statut} onChange={(e) => setStatut(e.target.value)} options={STATUT_OPTIONS} placeholder="Tous statuts GE" /></div>
        {mode === 'stock' && (
          <div className="w-48"><Select value={stock} onChange={(e) => setStock(e.target.value)} options={STOCK_OPTIONS} placeholder="Niveau stock" /></div>
        )}
        {besoinReseau && (
          <div className="w-52">
            <Select value={etatReseauFiltre} onChange={(e) => setEtatReseauFiltre(e.target.value)}
              options={[
                { value: 'DOWN', label: 'Entièrement coupés' },
                { value: 'PARTIEL', label: 'Coupures partielles' },
                { value: 'IMPACTE', label: 'Aval menacé' },
                { value: 'OK', label: 'En service' },
              ]}
              placeholder="Tous les états" />
          </div>
        )}
        {(region || statut || stock) && (
          <button onClick={() => { setRegion(''); setStatut(''); setStock(''); }} className="text-sm text-blue-600 underline hover:no-underline">Réinitialiser</button>
        )}
        </>)}
        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
          {vueLivraison ? (<>
            {camionsEnTournee.map((c) => (
              <button key={c} onClick={() => setCamion(camion === c ? '' : c)}
                className={`flex items-center gap-1 rounded px-1.5 py-0.5 ${camion === c ? 'bg-gray-200 font-semibold text-gray-800' : 'hover:bg-gray-100'}`}
                title="Cliquer pour filtrer sur ce camion">
                <span className="h-3 w-3 rounded-full" style={{ background: couleurParCamion[c] }} /> {c}
              </button>
            ))}
            {all.some((f) => (f.properties.camions ?? []).length > 1) && (
              <span className="flex items-center gap-1">
                <span className="h-3 w-3 rounded-full" style={{ background: COULEUR_MULTI_CAMIONS }} /> Plusieurs camions
              </span>
            )}
          </>) : modeTopo ? (
            colorationTopo === 'type' ? (<>
              {typesLiaisonListe.map((t) => (
                <span key={t.code} className="flex items-center gap-1" title={`${t.constructeur} · ${t.famille}`}>
                  <span className="h-0.5 w-4 rounded" style={{ background: couleurLiaison(t.code), borderTop: t.famille === 'FH' ? '2px dashed' : undefined, borderColor: couleurLiaison(t.code) }} /> {t.libelle}
                </span>
              ))}
              <span className="text-gray-400">FH en pointillé</span>
              <span className="mx-1 h-3 w-px bg-gray-200" />
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full border-2 border-[#1B3F6B]" /> Racine (tête de chaîne)</span>
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full border-2 border-dashed border-gray-400" /> Isolé (à rattacher)</span>
            </>) : (<>
              <span className="flex items-center gap-1"><span className="h-0.5 w-4 rounded bg-[#C0392B]" /> Coupé</span>
              <span className="flex items-center gap-1"><span className="h-0.5 w-4 rounded bg-[#E67E22]" /> Partiel</span>
              <span className="flex items-center gap-1"><span className="h-0.5 w-4 rounded bg-[#8E44AD]" /> Aval menacé</span>
              <span className="flex items-center gap-1"><span className="h-0.5 w-4 rounded bg-[#0E7C6B]" /> En service</span>
              <span className="mx-1 h-3 w-px bg-gray-200" />
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full border-2 border-[#1B3F6B]" /> Racine</span>
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full border-2 border-dashed border-gray-400" /> Isolé</span>
            </>)
          ) : modeReseau ? (<>
            <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-[#C0392B]" /> Site entièrement coupé</span>
            <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-[#E67E22]" /> Coupure partielle</span>
            <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-[#8E44AD]" /> Aval d&apos;un site coupé</span>
            <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-[#0E7C6B]" /> En service</span>
          </>) : (<>
            <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-[#DC2626]" /> Stock critique</span>
            <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-[#F59E0B]" /> Stock faible</span>
            <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-[#0E7C6B]" /> GE permanent</span>
            <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-[#2471A3]" /> GE secours</span>
            <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-gray-400" /> Pas de GE</span>
          </>)}
        </div>
      </div>

      <div className="flex-1 min-h-[500px] rounded-xl overflow-hidden border border-gray-200">
        {isLoading ? <Loading label="Chargement de la carte…" /> : (
          <SitesMap
            features={features}
            couleurParCamion={vueLivraison ? couleurParCamion : undefined}
            etatReseauParSite={etatReseauParSite}
            liaisons={liaisons}
            rolesTopo={rolesTopo}
            masquerStock={role === 'NOC'}
          />
        )}
      </div>
    </div>
  );
}
