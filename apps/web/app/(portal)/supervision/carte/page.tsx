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
import type { SiteFeature, EtatReseau } from '@/components/maps/SitesMap';
import { COULEUR_MULTI_CAMIONS, PALETTE_CAMIONS } from '@/components/maps/couleursCamions';

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
  // Deux lectures de la même carte : STOCK (logistique carburant) et RÉSEAU
  // (coupures + aval menacé — la question du NOC). Défaut selon le rôle.
  const [modeChoisi, setModeChoisi] = useState<'stock' | 'reseau' | null>(null);
  const mode = modeChoisi ?? (role === 'NOC' ? 'reseau' : 'stock');
  // Filtre d'état en mode réseau : isoler les coupés, partiels ou menacés.
  const [etatReseauFiltre, setEtatReseauFiltre] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['sites-geojson'],
    queryFn: () => api.get('/sites/geojson').then((r) => r.data),
  });

  const all: SiteFeature[] = useMemo(() => data?.features ?? [], [data]);
  // Vue transporteur : l'API ne sert que SES sites à livrer, sans stock ni
  // statut GE — les filtres et la légende d'exploitation n'ont pas de sens.
  const vueLivraison = data?.vue === 'transporteur';
  const [camion, setCamion] = useState('');

  // ── Mode réseau : coupures en cours + propagation à l'aval (topologie) ──
  const modeReseau = mode === 'reseau' && !vueLivraison;
  const { data: coupures } = useQuery({
    queryKey: ['coupures-en-cours-carte'],
    queryFn: () => api.get('/coupures-reseau', { params: { statut: 'EN_COURS', limit: 200 } })
      .then((r) => r.data.data as { siteId?: string; technologie?: string }[]),
    enabled: modeReseau,
    refetchInterval: 60_000,
  });
  const { data: liens } = useQuery({
    queryKey: ['sites-all'],
    queryFn: () => api.get('/sites', { params: { all: true } })
      .then((r) => r.data.data as { id: string; parentTransmissionId?: string | null }[]),
    enabled: modeReseau,
  });
  const etatReseauParSite = useMemo(() => {
    if (!modeReseau) return undefined;
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
    // un site qui a perdu sa 3G n'est pas un site mort — même règle de
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
  }, [modeReseau, coupures, liens]);

  // Une couleur STABLE par camion (ordre alphabétique des plaques) : la même
  // plaque garde sa couleur d'un chargement à l'autre tant que la flotte en
  // tournée ne change pas — le chauffeur mémorise « mon camion = vert ».
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
          : modeReseau
            ? `${Object.values(etatReseauParSite ?? {}).filter((e) => e.etat === 'DOWN').length} coupé(s) · ${Object.values(etatReseauParSite ?? {}).filter((e) => e.etat === 'PARTIEL').length} partiel(s) · ${Object.values(etatReseauParSite ?? {}).filter((e) => e.etat === 'IMPACTE').length} aval menacé(s) · actualisé chaque minute`
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
        {/* Bascule de lecture : Stock (logistique) / Réseau (coupures — vue NOC). */}
        <div className="flex overflow-hidden rounded-lg border border-gray-200 bg-white text-sm font-medium">
          {(['stock', 'reseau'] as const).map((m) => (
            <button key={m} type="button" onClick={() => setModeChoisi(m)}
              className={`px-3 py-2 ${mode === m ? 'bg-[#1B3F6B] text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
              {m === 'stock' ? 'Stock' : 'Réseau'}
            </button>
          ))}
        </div>
        <div className="w-44"><Select value={region} onChange={(e) => setRegion(e.target.value)} options={regionOptions} placeholder="Toutes régions" /></div>
        <div className="w-40"><Select value={statut} onChange={(e) => setStatut(e.target.value)} options={STATUT_OPTIONS} placeholder="Tous statuts GE" /></div>
        {!modeReseau && (
          <div className="w-48"><Select value={stock} onChange={(e) => setStock(e.target.value)} options={STOCK_OPTIONS} placeholder="Niveau stock" /></div>
        )}
        {modeReseau && (
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
          </>) : modeReseau ? (<>
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
          />
        )}
      </div>
    </div>
  );
}
