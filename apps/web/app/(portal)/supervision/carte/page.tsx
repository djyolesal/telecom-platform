'use client';

import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { Loading } from '@/components/shared/states';
import { useSupervisionSocket } from '@/lib/hooks/useSupervisionSocket';
import type { SiteFeature } from '@/components/maps/SitesMap';

// Leaflet ne supporte pas le SSR → import dynamique côté client uniquement
const SitesMap = dynamic(() => import('@/components/maps/SitesMap').then((m) => m.SitesMap), {
  ssr: false,
  loading: () => <Loading label="Chargement de la carte…" />,
});

export default function CartePage() {
  useSupervisionSocket();

  const { data, isLoading } = useQuery({
    queryKey: ['sites-geojson'],
    queryFn: () => api.get('/sites/geojson').then((r) => r.data),
  });

  const features: SiteFeature[] = data?.features ?? [];

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Carte de supervision" subtitle={`${features.length} sites géolocalisés · temps réel`} />
      <div className="flex items-center gap-4 mb-3 text-xs text-gray-500">
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-[#0E7C6B]" /> GE permanent</span>
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-[#2471A3]" /> GE secours</span>
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-gray-400" /> Pas de GE</span>
      </div>
      <div className="flex-1 min-h-[500px] rounded-xl overflow-hidden border border-gray-200">
        {isLoading ? <Loading label="Chargement de la carte…" /> : <SitesMap features={features} />}
      </div>
    </div>
  );
}
