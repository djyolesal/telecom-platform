'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { Loading } from '@/components/shared/states';
import { Select } from '@/components/shared/Form';
import { useSupervisionSocket } from '@/lib/hooks/useSupervisionSocket';
import type { SiteFeature } from '@/components/maps/SitesMap';
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
  const [region, setRegion] = useState('');
  const [statut, setStatut] = useState('');
  const [stock, setStock] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['sites-geojson'],
    queryFn: () => api.get('/sites/geojson').then((r) => r.data),
  });

  const all: SiteFeature[] = useMemo(() => data?.features ?? [], [data]);
  // Vue transporteur : l'API ne sert que SES sites à livrer, sans stock ni
  // statut GE — les filtres et la légende d'exploitation n'ont pas de sens.
  const vueLivraison = data?.vue === 'transporteur';
  const [camion, setCamion] = useState('');

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
        return true;
      }),
    [all, region, statut, stock, camion]
  );

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={vueLivraison ? 'Carte de mes livraisons' : 'Carte de supervision'}
        subtitle={vueLivraison
          ? `${all.length} site(s) à livrer selon vos plans en cours`
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
        <div className="w-44"><Select value={region} onChange={(e) => setRegion(e.target.value)} options={regionOptions} placeholder="Toutes régions" /></div>
        <div className="w-40"><Select value={statut} onChange={(e) => setStatut(e.target.value)} options={STATUT_OPTIONS} placeholder="Tous statuts GE" /></div>
        <div className="w-48"><Select value={stock} onChange={(e) => setStock(e.target.value)} options={STOCK_OPTIONS} placeholder="Niveau stock" /></div>
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
        {isLoading ? <Loading label="Chargement de la carte…" /> : <SitesMap features={features} couleurParCamion={vueLivraison ? couleurParCamion : undefined} />}
      </div>
    </div>
  );
}
