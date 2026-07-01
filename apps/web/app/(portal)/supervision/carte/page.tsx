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
const SUIVI_OPTIONS = [
  { value: 'oui', label: 'Avec relevé énergie' },
  { value: 'non', label: 'Sans relevé énergie' },
];

export default function CartePage() {
  useSupervisionSocket();
  const [region, setRegion] = useState('');
  const [statut, setStatut] = useState('');
  const [suivi, setSuivi] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['sites-geojson'],
    queryFn: () => api.get('/sites/geojson').then((r) => r.data),
  });

  const all: SiteFeature[] = useMemo(() => data?.features ?? [], [data]);

  // Régions présentes (pour le filtre).
  const regionOptions = useMemo(
    () => [...new Set(all.map((f) => f.properties.region).filter(Boolean))].sort().map((r) => ({ value: r, label: r })),
    [all]
  );

  const features = useMemo(
    () =>
      all.filter((f) => {
        if (region && f.properties.region !== region) return false;
        if (statut && f.properties.statutGE !== statut) return false;
        if (suivi === 'oui' && !f.properties.hasStock) return false;
        if (suivi === 'non' && f.properties.hasStock) return false;
        return true;
      }),
    [all, region, statut, suivi]
  );

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Carte de supervision" subtitle={`${features.length} / ${all.length} sites · temps réel`} />

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="w-44"><Select value={region} onChange={(e) => setRegion(e.target.value)} options={regionOptions} placeholder="Toutes régions" /></div>
        <div className="w-40"><Select value={statut} onChange={(e) => setStatut(e.target.value)} options={STATUT_OPTIONS} placeholder="Tous statuts GE" /></div>
        <div className="w-48"><Select value={suivi} onChange={(e) => setSuivi(e.target.value)} options={SUIVI_OPTIONS} placeholder="Suivi énergie" /></div>
        {(region || statut || suivi) && (
          <button onClick={() => { setRegion(''); setStatut(''); setSuivi(''); }} className="text-sm text-blue-600 underline hover:no-underline">Réinitialiser</button>
        )}
        <div className="ml-auto flex items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-[#0E7C6B]" /> GE permanent</span>
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-[#2471A3]" /> GE secours</span>
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-gray-400" /> Pas de GE</span>
        </div>
      </div>

      <div className="flex-1 min-h-[500px] rounded-xl overflow-hidden border border-gray-200">
        {isLoading ? <Loading label="Chargement de la carte…" /> : <SitesMap features={features} />}
      </div>
    </div>
  );
}
